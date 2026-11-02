import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router";
import styles from "./AppShell.module.css";
import { Logo } from "./Logo.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { IconButton } from "./ui.tsx";

export function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <IconButton label={open ? "关闭菜单" : "打开菜单"} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </IconButton>
        <Logo size={17} />
      </header>
      <aside className={[styles.side, open && styles.sideOpen].filter(Boolean).join(" ")}>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
