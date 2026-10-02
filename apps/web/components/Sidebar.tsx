"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Archive, Bell, FileText, Folder, Home, LockKeyhole, Settings, Users } from "./icons";
import { Brand } from "./Brand";

type NavigationItem = {
  label: string;
  icon: typeof Home;
  href?: Route;
};

const links: NavigationItem[] = [
  { label: "Home", icon: Home, href: "/dashboard" },
  { label: "Documents", icon: FileText, href: "/documents" },
  { label: "Profiles", icon: Users, href: "/profiles" },
  { label: "Search", icon: Folder },
];

function DisabledItem({ label, icon: Icon }: NavigationItem) {
  return (
    <button type="button" className="side-item" disabled title={`${label} is not implemented yet`} aria-describedby="dashboard-availability">
      <Icon size={17} />
      {label}
    </button>
  );
}

function NavigationItemView({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const Icon = item.icon;
  if (!item.href) return <DisabledItem {...item} />;
  const active = pathname === item.href;
  return (
    <Link className={`side-item ${active ? "active" : ""}`} href={item.href} aria-current={active ? "page" : undefined}>
      <Icon size={17} strokeWidth={active ? 2.4 : 1.8} />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="side-brand"><Brand /></div>
      <nav className="side-nav" aria-label="Main navigation">
        {links.map((item) => <NavigationItemView item={item} pathname={pathname} key={item.label} />)}
        <div className="side-label">Family space</div>
        <Link className={`side-item ${pathname.startsWith("/family") ? "active" : ""}`} href="/family" aria-current={pathname.startsWith("/family") ? "page" : undefined}><Users size={17} strokeWidth={pathname.startsWith("/family") ? 2.4 : 1.8} />Family</Link>
        <DisabledItem label="Notifications" icon={Bell} />
        <div className="side-label">Workspace</div>
        <DisabledItem label="Security" icon={LockKeyhole} />
        <DisabledItem label="Settings" icon={Settings} />
      </nav>
      <div className="side-bottom"><DisabledItem label="Trash" icon={Archive} /></div>
    </aside>
  );
}
