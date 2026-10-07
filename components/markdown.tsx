import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders curriculum Markdown. react-markdown doesn't render raw HTML, so content can't inject markup. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h2 className="text-xl font-semibold text-neutral-950 dark:text-white" {...props} />,
          h2: (props) => <h3 className="pt-2 text-lg font-semibold text-neutral-950 dark:text-white" {...props} />,
          h3: (props) => <h4 className="pt-1 font-semibold text-neutral-950 dark:text-white" {...props} />,
          ul: (props) => <ul className="list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
          code: ({ className, ...props }) =>
            className ? (
              <code className={`block overflow-x-auto rounded-md bg-neutral-100 p-3 font-mono text-[13px] dark:bg-neutral-800 ${className}`} {...props} />
            ) : (
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[13px] dark:bg-neutral-800" {...props} />
            ),
          pre: (props) => <pre className="overflow-x-auto" {...props} />,
          blockquote: (props) => <blockquote className="border-l-4 border-indigo-300 pl-3 text-neutral-700 dark:border-indigo-700 dark:text-neutral-300" {...props} />,
          table: (props) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: (props) => <th className="border-b border-neutral-300 px-2 py-1 text-left font-semibold dark:border-neutral-700" {...props} />,
          td: (props) => <td className="border-b border-neutral-200 px-2 py-1 align-top dark:border-neutral-800" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
