import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, AbstractInputSuggest, ISuggestOwner } from 'obsidian';
import { LibbyImportService } from './src/services/LibbyImportService';
import { FuzzySuggestModal } from 'obsidian';

interface LibbyImportPluginSettings {
    newFileLocation: string;
    newFileName: string;
}

const DEFAULT_SETTINGS: LibbyImportPluginSettings = {
    newFileLocation: '',
    newFileName: '{{title}} - {{author}}',
}

class LibbyImportModal extends Modal {
    private importService: LibbyImportService;

    constructor(app: App, plugin: LibbyImportPlugin) {
        super(app);
        this.importService = new LibbyImportService(app, plugin);
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.createEl("h2", {text: "Import Libby Journey File"});
        
        const subheading = contentEl.createEl("p", {
            cls: "libby-import-subheading"
        });
        subheading.setText("Only JSON files supported. To find out how to export files from Libby ");
        const link = subheading.createEl("a", {
            text: "click here",
            href: "https://help.libbyapp.com/en-us/6151.htm",
        });

        subheading.createEl("span", { text: "." });

        const container = contentEl.createEl("div", {
            cls: "libby-import-container"
        });

        const inputEl = container.createEl("input", {
            type: "file",
            attr: {
                accept: ".json"
            },
            cls: "libby-file-input"
        });

        // Auto-focus the file input when modal opens
        setTimeout(() => inputEl.focus(), 0);

        const importButton = container.createEl("button", {
            text: "Import",
            cls: "libby-import-button",
            attr: {
                type: "submit"
            }
        });

        // Prevent form submission on enter
        contentEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (inputEl.files?.length) {
                    importButton.click();
                }
            }
        });

        // Focus import button when file is selected
        inputEl.addEventListener("change", () => {
            if (inputEl.files?.length) {
                setTimeout(() => importButton.focus(), 0);
            }
        });

        importButton.addEventListener("click", async () => {
            const file = inputEl.files?.[0];
            if (!file) {
                new Notice("Please select a file first");
                return;
            }

            try {
                new Notice("File import started");
                const content = await file.text();
                const bookData = await this.importService.parseJsonFile(content);
                await this.importService.createFile(bookData);
                new Notice(`Successfully imported ${bookData.title}`);
                this.close();
            } catch (error) {
                if (error.message === 'Import cancelled') {
                    new Notice('Import cancelled');
                } else {
                    new Notice(`Error importing file: ${error.message}`);
                    console.error(error);
                }
            }
        });
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

// Add this class after the LibbyImportModal
class FolderSuggest extends AbstractInputSuggest<string> {
    private folders: string[];
    protected inputEl: HTMLInputElement;
    protected suggest: ISuggestOwner<string>;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.inputEl = inputEl;
        this.folders = ["/"].concat(this.app.vault.getAllFolders().map(folder => folder.path));
    }

    getSuggestions(inputStr: string): string[] {
        const inputLower = inputStr.toLowerCase();
        return this.folders.filter(folder => 
            folder.toLowerCase().includes(inputLower)
        );
    }

    renderSuggestion(folder: string, el: HTMLElement): void {
        el.createEl("div", { text: folder });
    }

    selectSuggestion(folder: string): void {
        this.inputEl.value = folder;
        const event = new Event('input');
        this.inputEl.dispatchEvent(event);
        this.close();
    }
}

class LibbyImportSettingTab extends PluginSettingTab {
    plugin: LibbyImportPlugin;
    private folders: string[] = [];

    constructor(app: App, plugin: LibbyImportPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.loadFolders();
    }

    private async loadFolders() {
        const folders = this.app.vault.getAllFolders();
        this.folders = folders.map(folder => folder.path);
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        // New file location
        new Setting(containerEl)
            .setName('New file location')
            .setDesc('New book notes will be placed here.')
            .addSearch(search => {
                search
                    .setPlaceholder('Example: folder1/folder2')
                    .setValue(this.plugin.settings.newFileLocation)
                    .onChange(async (value) => {
                        this.plugin.settings.newFileLocation = value;
                        await this.plugin.saveSettings();
                    });

                // Add folder suggestions
                new FolderSuggest(this.app, search.inputEl);
            });

        // New file name
        new Setting(containerEl)
            .setName('New file name')
            .setDesc(createFragment(frag => {
                frag.appendText('Enter the file name format. Default: {{title}} - Libby Journey');
                frag.createEl('br');
                frag.createEl('br');
                frag.appendText('Variables: {{title}}, {{author}}, {{publisher}}, {{format}}, {{ISBN}}');
                frag.createEl('br');
                frag.appendText('{{dateImported}}, {{dateBorrowed}}.');


            }))
            .addSearch(search => {
                search
                    .setPlaceholder('{{title}} - {{author}}')
                    .setValue(this.plugin.settings.newFileName)
                    .onChange(async (value) => {
                        this.plugin.settings.newFileName = value;
                        await this.plugin.saveSettings();
                    });
            });
    }
}

export default class LibbyImportPlugin extends Plugin {
    settings: LibbyImportPluginSettings;

    async onload() {
        await this.loadSettings();

        const ribbonIconEl = this.addRibbonIcon(
            'book',
            'Import Libby Reading Data',
            () => {
                new LibbyImportModal(this.app, this).open();
            }
        );
        ribbonIconEl.addClass('libby-import-ribbon-class');

        this.addCommand({
            id: 'open-libby-import-modal',
            name: 'Import Libby Reading Data',
            callback: () => {
                new LibbyImportModal(this.app, this).open();
            }
        });

        this.addSettingTab(new LibbyImportSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}