"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CoachIcon, FoodieIcon, HomeIcon, PlusIcon, UserIcon } from "./icons";

/** The five destinations that are always one tap away.
 *
 * Five is the ceiling for a bottom bar before the targets get too narrow to
 * hit; everything rarer (weigh-ins, saved foods, settings) lives behind
 * "You". Labels sit under every icon on purpose -- an icon alone is a guess.
 */
const TABS = [
  { href: "/dashboard", label: "Today", Icon: HomeIcon },
  { href: "/coach", label: "Coach", Icon: CoachIcon },
  { href: "/log", label: "Log", Icon: PlusIcon, primary: true },
  { href: "/foodie", label: "Foodie", Icon: FoodieIcon },
  { href: "/you", label: "You", Icon: UserIcon },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/85 backdrop-blur-xl"
    >
      <ul className="safe-bottom mx-auto flex max-w-md items-end justify-around px-2 pt-1.5">
        {TABS.map(({ href, label, Icon, primary }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);

          // The log button is the reason the app exists, so it is raised out of
          // the bar rather than floating over the content it would cover.
          if (primary) {
            return (
              <li key={href} className="-mt-6">
                <Link
                  href={href}
                  aria-label="Log a meal"
                  className="btn btn-primary flex h-16 w-16 flex-col items-center justify-center gap-0 rounded-full p-0"
                >
                  <PlusIcon className="h-7 w-7" />
                  <span className="text-[0.6rem] font-extrabold tracking-wide">LOG</span>
                </Link>
              </li>
            );
          }

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 transition-colors ${
                  active ? "text-accent" : "text-ink-dim"
                }`}
              >
                <Icon className={active ? "h-6 w-6" : "h-[1.35rem] w-[1.35rem]"} />
                <span className="text-[0.65rem] font-bold">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
