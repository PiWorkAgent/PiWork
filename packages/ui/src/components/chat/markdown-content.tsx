import { useState, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import './hljs-theme.css';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/i18n';
import { MermaidDiagram } from './mermaid-diagram';
import { renderTokenizedText } from '@/lib/token-parser';
import { isPlainClick, openLinkInBrowserPanel } from '@/lib/open-link';
import { usePluginStore } from '@/stores/plugin-store';

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
}

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = extractText(children);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [children]);

  const language = className?.replace('language-', '') || '';

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <span className="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[0.625rem] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
          aria-label={copied ? t('已复制') : t('复制代码')}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t('已复制！')}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="!mt-0 !rounded-none !border-0">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/** Recursively extract text content from React children */
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (typeof children === 'object' && 'props' in children) {
    return extractText((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function MarkdownContentImpl({ content, isStreaming }: MarkdownContentProps) {
  return (
    <div className="md-body max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, node: _node, ...props }) => {
            const match = /language-/.exec(className || '');
            const isInline = !match;
            const codeContent = children as React.ReactNode;

            if (isInline) {
              return (
                <code className={className} {...props}>
                  {codeContent}
                </code>
              );
            }

            const langMatch = /language-(\w+)/.exec(className || '');
            const language = langMatch ? langMatch[1] : '';
            const source = extractText(codeContent);

            if (language === 'mermaid') {
              return (
                <MermaidDiagram
                  source={source}
                  isStreaming={isStreaming}
                />
              );
            }

            return (
              <CodeBlock className={className}>
                {codeContent}
              </CodeBlock>
            );
          },
          p: ({ children, node: _node, ...props }) => {
            const text = extractText(children);
            const hasToken = /(?:^|\s)(?:\/[a-zA-Z][\w-]*|@[\w][\w-]*)/.test(text);
            if (hasToken) {
              return <p {...props}>{renderTokenizedText(text)}</p>;
            }
            return <p {...props}>{children}</p>;
          },
          a: ({ children, href, node: _node, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
              onClick={(event) => {
                // A plain click on a web link belongs in the app's own
                // browser panel (a new tab), not the OS. The plugins are read
                // at click time rather than subscribed: a Markdown body must
                // not re-render when the plugin list changes.
                if (!isPlainClick(event)) return;
                if (href && openLinkInBrowserPanel(href, usePluginStore.getState().plugins)) {
                  event.preventDefault();
                }
                // Otherwise the `target=_blank` default stands, and the shell
                // sends it to the system browser.
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoized: ReactMarkdown + rehypeHighlight re-parse the WHOLE document on
 * every render, so an unmemoized instance costs O(document) per keystroke of
 * the stream. During streaming the parent re-renders once per chunk, which
 * re-parsed every message in the conversation each time and dropped ~38% of
 * frames. Props are a string and a boolean, so the comparison is exact.
 */
export const MarkdownContent = memo(MarkdownContentImpl);
