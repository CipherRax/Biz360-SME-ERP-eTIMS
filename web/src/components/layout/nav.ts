import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Boxes,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import type { Role } from '@/types/domain';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  match?: string[];
}

const ALL: Role[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'READ_ONLY'];
const FINANCE: Role[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT'];
const SALES: Role[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF'];

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL },
  { href: '/sales', label: 'Sales', icon: Receipt, roles: SALES, match: ['/sales'] },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart, roles: FINANCE },
  { href: '/inventory', label: 'Inventory', icon: Package, roles: ALL },
  { href: '/customers', label: 'Customers', icon: Users, roles: ALL },
  { href: '/suppliers', label: 'Suppliers', icon: Truck, roles: ALL },
  { href: '/products', label: 'Products', icon: Boxes, roles: ALL },
  { href: '/accounting', label: 'Accounting', icon: BookOpen, roles: FINANCE },
  { href: '/etims', label: 'eTIMS', icon: ShieldCheck, roles: ALL },
  { href: '/reports', label: 'Reports', icon: BarChart3, roles: FINANCE },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['ADMIN'] },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return (item.match ?? [item.href]).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}