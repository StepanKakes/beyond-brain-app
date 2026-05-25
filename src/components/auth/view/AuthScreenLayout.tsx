import type { ReactNode } from 'react';

type AuthScreenLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footerText: string;
  logo?: ReactNode;
};

/**
 * Beyond v2 — hyperminimal auth screen.
 * Pure white, tiny centered content block, no big logo blob, no chrome.
 */
export default function AuthScreenLayout({
  title,
  description,
  children,
  footerText,
  logo,
}: AuthScreenLayoutProps) {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center bg-white px-6 py-10">
      <div className="w-full max-w-[360px]">
        <div className="text-center">
          {logo && <div className="mb-6 flex justify-center">{logo}</div>}
          <h1 className="font-hero italic text-[2.25rem] leading-tight text-beyond-ink">
            {title}
          </h1>
          <p className="mt-2 text-[14px] text-beyond-dim">{description}</p>
        </div>

        <div className="mt-10">{children}</div>

        <p className="mt-10 text-center text-[12px] text-beyond-faint">{footerText}</p>
      </div>
    </div>
  );
}
