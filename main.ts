import { App, MarkdownView, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface FocusPluginSettings {
	clearMethod: 'click-again' | 'click-outside';
}

const DEFAULT_SETTINGS: FocusPluginSettings = {
	clearMethod: 'click-again'
}

interface FocusInfo {
	focusHead: Element;
	focusBody: Set<Element>;
}

export default class FocusPlugin extends Plugin {
	settings: FocusPluginSettings;
	observer: MutationObserver;
	classes: { [key: string]: string } = {
		'enabled': 'focus-plugin-enabled',
		'dimmed': 'focus-plugin-dimmed',
		'focus-animation': 'focus-plugin-focus-animation',
		'dim-animation': 'focus-plugin-dim-animation'
	}
	paneInfo: WeakMap<Element, FocusInfo> = new WeakMap();
	order = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
	observeHead: Element | null = null;

	private findContents(headNode: Element, startNode: Element) {
		let contents: Array<Element> = [];
		let nextNode: Element | null = startNode;
		let headTag = headNode.firstElementChild?.tagName;

		if (!headTag || !this.order.includes(headTag))
			return contents;

		while (nextNode) {
			let currentTag = nextNode.firstElementChild?.tagName;
			if (currentTag && this.order.includes(currentTag) && this.order.indexOf(currentTag) <= this.order.indexOf(headTag))
				break;
			contents.push(nextNode);
			nextNode = nextNode.nextElementSibling;
		}

		return contents;
	}

	private dim_node(node: Element, animation: boolean) {
		if (animation) {
			node.addEventListener('animationend', () => {
				node.classList.remove(this.classes['dim-animation']);
			}, { once: true });
			node.classList.add(this.classes['dim-animation']);
		}
		node.classList.add(this.classes['dimmed']);
	}

	private undim_node(node: Element, animation: boolean) {
		if (animation) {
			node.addEventListener('animationend', () => {
				node.classList.remove(this.classes['focus-animation']);
			}, { once: true });
			node.classList.add(this.classes['focus-animation']);
		}
		node.classList.remove(this.classes['dimmed']);
	}

	private clear(all: boolean, animation: boolean) {
		if (all) {
			document.querySelectorAll(`.${this.classes['dimmed']}`).forEach(node => this.undim_node(node, animation));
			this.paneInfo = new WeakMap();
			return;
		}

		// quick exit
		if (!this.observeHead)
			return;

		// remove dimmed class
		this.observeHead.querySelectorAll(`.${this.classes['dimmed']}`).forEach(node => this.undim_node(node, animation));

		// remove focus information of active pane
		this.paneInfo.delete(this.observeHead);
	}

	observe() {
		// disconnect original observer
		this.observer.disconnect();
		
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.getMode() === 'preview') {
			// update observe head
			this.observeHead = view.contentEl.querySelector('.markdown-preview-section') as Element;
			
			// observe new head node
			this.observer.observe(this.observeHead, { childList: true });

			console.log('focus-plugin: observing');
		}
	}

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'clear-focus',
			name: 'Clear Focus',
			callback: () => {
				this.clear(true, false);
			}
		});

		this.addSettingTab(new FocusPluginSettingTab(this.app, this));

		document.body.classList.add(this.classes['enabled']);

		this.observer = new MutationObserver(mutations => {
			mutations.forEach(mutation => {
				if (!this.observeHead || !this.paneInfo.has(this.observeHead)) {
					this.clear(false, false);
					return;
				}
				
				const focusInfo = this.paneInfo.get(this.observeHead) as FocusInfo;
				if (mutation.addedNodes.length > 0) {
					[focusInfo.focusHead, ...focusInfo.focusBody].forEach(content => {
						let nextNode = content.nextElementSibling;
						if (nextNode) {
							let newNodes = this.findContents(focusInfo.focusHead, nextNode);
							newNodes.forEach(node => {
								this.undim_node(node, false);
								focusInfo.focusBody.add(node);
							});
						}
					})
				}

				const allNodes = Array.from(this.observeHead.children);
				allNodes.forEach(node => {
					if (!focusInfo.focusBody.has(node) && (node !== focusInfo.focusHead))
						this.dim_node(node, false);
				});
			});
		});

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.clear(false, false);
			this.observe();
		}));

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.observe();
		}));

		this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
			console.log('focus-plugin: click');
			// only work under markdown preview
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!markdownView || (markdownView.getMode() !== 'preview') || !(evt.target instanceof Element) || !this.observeHead)
				return;

			const element = evt.target;
			const block = element.parentElement;
			
			// restore
			if (this.paneInfo.get(this.observeHead)) {
				const focusInfo = this.paneInfo.get(this.observeHead) as FocusInfo;
				switch (this.settings.clearMethod) {
					case 'click-again':
						if (block && focusInfo.focusHead && (block === focusInfo.focusHead)) {
							this.clear(false, true);
							return;
						}
						break;
					case 'click-outside':
						if (element.classList.contains('markdown-preview-view')) {
							this.clear(false, true);
							return;
						}
						break;
				}
			}

			// only work under headings for now
			// TODO: add support for lists, code blocks, etc.
			if (!block || !(element.hasAttribute('data-heading')))
				return;
			
			let focusInfo = { focusHead: block, focusBody: new Set<Element>() };

			// set focus
			let contents: Array<Element> = [];
			if (block.nextElementSibling)
				contents = this.findContents(block, block.nextElementSibling);

			[block, ...contents].forEach(node => {
				if (node.classList.contains(this.classes['dimmed']))
					this.undim_node(node, true);
			});

			contents.forEach(content => focusInfo.focusBody.add(content));

			// set nextNode dim
			const allNodes = Array.from(this.observeHead.children);
			allNodes.forEach(node => {
				if (!focusInfo.focusBody.has(node) && (node !== focusInfo.focusHead)) {
					if (!node.classList.contains(this.classes['dimmed']))
						this.dim_node(node, true);
				}
			});
			
			this.paneInfo.set(this.observeHead, focusInfo);
		});

		this.observe();
	}

	onunload() {
		// tricky but quick way to disable all css classes
		document.body.classList.remove(this.classes['enabled']);
		
		// try to remove viewable dimmed classes, solve reenable issue
		this.clear(true, false);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class FocusPluginSettingTab extends PluginSettingTab {
	plugin: FocusPlugin;

	constructor(app: App, plugin: FocusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Focus and Highlight Settings' });

		new Setting(containerEl)
			.setName('Clear Method')
			.setDesc('How to clear the focused elements')
			.addDropdown(dropdown => dropdown.addOptions({
				'click-again': 'Click again',
				'click-outside': 'Click outside',
			})
				.setValue(this.plugin.settings.clearMethod)
				.onChange(async (value: FocusPluginSettings["clearMethod"]) => {
					this.plugin.settings.clearMethod = value;
					await this.plugin.saveSettings();
					console.log('focus-plugin: clear method changed to ' + value);
				}));
	}
}
