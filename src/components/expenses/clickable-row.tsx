"use client";

import { useRouter } from "next/navigation";

interface ClickableRowProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

export function ClickableRow({ href, children, className = "" }: ClickableRowProps) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      className={`cursor-pointer transition-colors hover:bg-gray-100 ${className}`}
    >
      {children}
    </tr>
  );
}
