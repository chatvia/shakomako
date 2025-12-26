/**
 * Lightweight Markdown Parser
 * Handles common markdown patterns from LLM responses
 * ~3KB vs marked's ~97KB
 */

/**
 * Parse markdown text to HTML
 * Supports: headers, bold, italic, code blocks, inline code, 
 * links, lists, tables, blockquotes, horizontal rules, line breaks
 */
export function parseMarkdown(text) {
    if (!text) return '';

    let html = text;

    // Escape HTML entities first (except for what we'll process)
    html = escapeHtml(html);

    // Code blocks (``` ... ```) - must be processed first
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
    });

    // Inline code (`code`)
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Headers (# to ######)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold and italic combinations
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic (*text* or _text_)
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g, '<em>$1</em>');

    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Images ![alt](url) - MUST come before links to prevent link regex from matching
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0;">');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Blockquotes (> text)
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // Horizontal rules (---, ***, ___)
    html = html.replace(/^[-*_]{3,}$/gm, '<hr>');

    // Tables
    html = parseTable(html);

    // Unordered lists (- or * or +)
    html = parseList(html, /^[\-\*\+]\s+(.+)$/gm, 'ul');

    // Ordered lists (1. 2. etc)
    html = parseList(html, /^\d+\.\s+(.+)$/gm, 'ol');

    // Paragraphs - wrap remaining text blocks
    html = wrapParagraphs(html);

    // Line breaks within paragraphs (two spaces + newline or explicit \n)
    html = html.replace(/  \n/g, '<br>');

    return html.trim();
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Parse markdown tables
 */
function parseTable(html) {
    const lines = html.split('\n');
    const result = [];
    let inTable = false;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Check if this is a table row (starts and ends with |, or has | separators)
        if (line.includes('|') && (line.startsWith('|') || line.match(/^[^|]+\|/))) {
            // Check if it's a separator row (|---|---|)
            if (line.match(/^\|?\s*[-:]+[-|\s:]+\|?\s*$/)) {
                // This is the header separator, mark table as started
                if (tableRows.length > 0) {
                    inTable = true;
                }
                continue;
            }

            // Parse table row
            const cells = line
                .replace(/^\||\|$/g, '') // Remove leading/trailing pipes
                .split('|')
                .map(cell => cell.trim());

            if (cells.length > 0 && cells.some(c => c.length > 0)) {
                tableRows.push(cells);
            }
        } else {
            // Not a table row
            if (tableRows.length > 0) {
                // Flush the table
                result.push(buildTable(tableRows, inTable));
                tableRows = [];
                inTable = false;
            }
            result.push(lines[i]);
        }
    }

    // Flush any remaining table
    if (tableRows.length > 0) {
        result.push(buildTable(tableRows, inTable));
    }

    return result.join('\n');
}

/**
 * Build HTML table from rows
 */
function buildTable(rows, hasHeader) {
    if (rows.length === 0) return '';

    let html = '<table>';

    if (hasHeader && rows.length > 0) {
        html += '<thead><tr>';
        rows[0].forEach(cell => {
            html += `<th>${cell}</th>`;
        });
        html += '</tr></thead>';
        rows = rows.slice(1);
    }

    if (rows.length > 0) {
        html += '<tbody>';
        rows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => {
                html += `<td>${cell}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody>';
    }

    html += '</table>';
    return html;
}

/**
 * Parse lists (ordered and unordered)
 */
function parseList(html, pattern, listType) {
    const lines = html.split('\n');
    const result = [];
    let inList = false;
    let listItems = [];

    // Determine the regex for this list type
    const isUnordered = listType === 'ul';
    const listItemRegex = isUnordered
        ? /^[\-\*\+]\s+(.+)$/
        : /^\d+\.\s+(.+)$/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(listItemRegex);

        if (match) {
            if (!inList) {
                inList = true;
            }
            listItems.push(match[1]);
        } else {
            if (inList && listItems.length > 0) {
                // Flush the list
                result.push(`<${listType}>${listItems.map(item => `<li>${item}</li>`).join('')}</${listType}>`);
                listItems = [];
                inList = false;
            }
            result.push(line);
        }
    }

    // Flush any remaining list
    if (listItems.length > 0) {
        result.push(`<${listType}>${listItems.map(item => `<li>${item}</li>`).join('')}</${listType}>`);
    }

    return result.join('\n');
}

/**
 * Wrap text blocks in paragraphs
 */
function wrapParagraphs(html) {
    // Split by double newlines (paragraph breaks)
    const blocks = html.split(/\n\n+/);

    return blocks.map(block => {
        const trimmed = block.trim();

        // Don't wrap if it's already a block element
        if (!trimmed) return '';
        if (trimmed.startsWith('<h')) return trimmed;
        if (trimmed.startsWith('<p')) return trimmed;
        if (trimmed.startsWith('<ul')) return trimmed;
        if (trimmed.startsWith('<ol')) return trimmed;
        if (trimmed.startsWith('<pre')) return trimmed;
        if (trimmed.startsWith('<table')) return trimmed;
        if (trimmed.startsWith('<blockquote')) return trimmed;
        if (trimmed.startsWith('<hr')) return trimmed;

        // Wrap in paragraph, converting single newlines to <br>
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
}

