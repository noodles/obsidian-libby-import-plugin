import { App, Notice } from 'obsidian';
import LibbyImportPlugin from '../../main';

interface LibbyEvent {
    type: 'Highlight' | 'Bookmark';
    text: string;
    timestamp: number;
    percent: number;
    chapter: string;
    color?: string;
    quote?: string;
}

interface LibbyBook {
    title: string;
    author: string;
    publisher: string;
    isbn: string;
    percent: number;
    format: string;
    events: LibbyEvent[];
    circulation: {
        timestamp: number;
        activity: string;
        details?: string;
        library: {
            text: string;
        };
    }[];
}

export class LibbyImportService {
    private app: App;
    private plugin: LibbyImportPlugin;

    constructor(app: App, plugin: LibbyImportPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    private formatFileName(book: LibbyBook): string {
        let fileName = this.plugin.settings.newFileName;
        
        // Replace all supported variables
        const replacements: { [key: string]: string } = {
            '{{title}}': book.title || '',
            '{{author}}': book.author || '',
            '{{publisher}}': book.publisher || '',
            '{{format}}': book.format || '',
            '{{ISBN}}': book.isbn || '',
            '{{dateImported}}': new Date().toISOString().split('T')[0],
            '{{dateBorrowed}}': book.circulation[0]?.timestamp ? 
                new Date(book.circulation[0].timestamp).toISOString().split('T')[0] : ''
        };

        for (const [key, value] of Object.entries(replacements)) {
            fileName = fileName.replace(key, value);
        }

        // Sanitize filename
        fileName = fileName.replace(/[\\/:*?"<>|]/g, '-');
        return fileName;
    }

    async createFile(book: LibbyBook): Promise<void> {
        const baseFileName = this.formatFileName(book);
        const folderPath = this.plugin.settings.newFileLocation || '';
        let fileName = `${baseFileName}.md`;
        let filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
        let version = 1;

        while (await this.app.vault.adapter.exists(filePath)) {
            const modal = new Notice(
                `File "${fileName}" already exists.`,
                0
            );

            const choice = await new Promise<string>((resolve) => {
                const modalEl = modal.noticeEl;

                const buttonContainer = modalEl.createEl('div', {
                    cls: 'libby-import-buttons'
                });

                const createButton = (text: string, value: string) => {
                    const btn = buttonContainer.createEl('button', { text });
                    btn.addEventListener('click', () => {
                        modal.hide();
                        resolve(value);
                    });
                };

                createButton('Replace', 'replace');
                createButton('Save as new', 'new');
                createButton('Cancel', 'cancel');
            });

            if (choice === 'replace') {
                break;
            } else if (choice === 'cancel') {
                throw new Error('Import cancelled');
            } else {
                fileName = `${baseFileName} ${version}.md`;
                filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
                version++;
            }
        }

        // Create folder if it doesn't exist
        if (folderPath) {
            const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
            if (!folderExists) {
                await this.app.vault.createFolder(folderPath);
            }
        }

        const markdown = this.generateMarkdown(book);
        
        if (await this.app.vault.adapter.exists(filePath)) {
            await this.app.vault.adapter.remove(filePath);
        }
        await this.app.vault.create(filePath, markdown);
    }

    async parseJsonFile(fileContent: string): Promise<LibbyBook> {
        try {
            const data = JSON.parse(fileContent);
            
            // Check if it's a Libby file
            if (!data.readingJourney || !data.circulation) {
                throw new Error("The file you have uploaded doesn't look like a Libby data file and could not be imported.");
            }

            // Check version
            if (data.version > 1) {
                const modal = new Notice(
                    "It looks like Libby has made some changes to their data format that might cause some errors. Please notify the plugin developer.",
                    0
                );

                const choice = await new Promise<string>((resolve) => {
                    const modalEl = modal.noticeEl;

                    const buttonContainer = modalEl.createEl('div', {
                        cls: 'libby-import-buttons'
                    });

                    const createButton = (text: string, value: string) => {
                        const btn = buttonContainer.createEl('button', { text });
                        btn.addEventListener('click', () => {
                            modal.hide();
                            resolve(value);
                        });
                    };

                    createButton('Import anyway', 'import');
                    createButton('Cancel', 'cancel');
                });

                if (choice === 'cancel') {
                    throw new Error('Import cancelled');
                }
            }

            return this.formatLibbyData(data);
        } catch (error) {
            throw error;
        }
    }
    
    private formatLibbyData(data: any): LibbyBook {
        // Convert bookmarks to events
        const bookmarkEvents = (data.bookmarks || []).map((bookmark: {
            chapter: string;
            timestamp: number;
            percent: number;
        }) => ({
            type: 'Bookmark' as const,
            text: bookmark.chapter,
            timestamp: bookmark.timestamp,
            percent: bookmark.percent,
            chapter: bookmark.chapter
        }));

        // Convert highlights to events
        const highlightEvents = (data.highlights || []).map((highlight: {
            quote: string;
            timestamp: number;
            percent: number;
            chapter: string;
            color: string;
        }) => ({
            type: 'Highlight' as const,
            text: highlight.quote,
            timestamp: highlight.timestamp,
            percent: highlight.percent,
            chapter: highlight.chapter,
            color: this.getHighlightColor(highlight.color),
            quote: highlight.quote
        }));

        // Combine and sort all events
        const events = [...bookmarkEvents, ...highlightEvents].sort(
            (a, b) => a.timestamp - b.timestamp
        );

        return {
            title: data.readingJourney.title.text,
            author: data.readingJourney.author,
            publisher: data.readingJourney.publisher,
            isbn: data.readingJourney.isbn,
            percent: data.readingJourney.percent * 100,
            format: data.readingJourney.cover.format,
            events,
            circulation: data.circulation
        };
    }

    private getHighlightColor(color: string): string {
        switch (color) {
            case '#FFB': return '🟨';
            case '#DFC': return '💚';
            case '#FFE0EC': return '💗';
            default: return '🟨';
        }
    }

    generateMarkdown(book: LibbyBook): string {
        let markdown = `# ${book.title}\n`;
        markdown += `by ${book.author}\n\n`;

        // Book Details
        markdown += `## Book Details\n`;
        markdown += `- Publisher: ${book.publisher}\n`;
        markdown += `- ISBN: ${book.isbn}\n`;
        markdown += `- Progress: ${Math.round(book.percent)}%\n`;
        markdown += `- Format: ${book.format}\n\n`;

        // Reading Timeline
        markdown += `## Reading Timeline\n\n`;

        // Group events by date
        const eventsByDate = this.groupEventsByDate(book.events);
        
        for (const [date, events] of Object.entries(eventsByDate)) {
            markdown += `### ${date}\n`;
            events.forEach(event => {
                const progress = `(${Math.round(event.percent * 100)}%)`;
                if (event.type === 'Bookmark') {
                    markdown += `- **Bookmark 🔖** Chapter ${event.text} ${progress}\n`;
                } else {
                    markdown += `- **Highlight** ${event.color} "${event.quote}" ${progress}\n`;
                }
            });
            markdown += '\n';
        }

        // Circulation History
        markdown += `## Circulation History\n`;
        book.circulation.forEach((event, index) => {
            const date = new Date(event.timestamp).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
            const details = event.details ? ` (${event.details.trim()})` : '';
            markdown += `${index + 1}. ${date} - ${event.activity}${details}\n`;
        });
        markdown += '\n';

        // Library attribution
        markdown += `*Borrowed from ${book.circulation[0].library.text}*\n`;

        return markdown;
    }

    private groupEventsByDate(events: LibbyEvent[]): Record<string, LibbyEvent[]> {
        const grouped: Record<string, LibbyEvent[]> = {};
        
        events.forEach(event => {
            const date = new Date(event.timestamp).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            grouped[date].push(event);
        });

        return grouped;
    }

}