import type { AnchorHTMLAttributes, ReactNode } from "react";

function configuredBasePath() {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLMetaElement>('meta[name="app-base-path"]')?.content.replace(/\/$/, "") || "";
}

export function publicPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${configuredBasePath()}${normalized}`;
}

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

export function AppLink({ href, children, ...props }: AppLinkProps) {
  return <a href={publicPath(href)} {...props}>{children}</a>;
}
