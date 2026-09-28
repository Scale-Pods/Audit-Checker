"use client";
import { useEffect } from "react";
import Sidebar5Demo from "@/components/ui/sidebar-5-demo";

export default function SidebarDemo() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  return (
    <div className="min-h-screen w-full bg-background">
      <Sidebar5Demo />
    </div>
  );
}