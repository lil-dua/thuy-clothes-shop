import { useState } from "react";
import { Form, Link, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireAdmin } from "~/lib/auth.server";
import { releaseExpiredOrders } from "~/lib/order.server";
import { cn } from "~/lib/format";
import {
	ChartIcon,
	CloseIcon,
	GridIcon,
	LogoutIcon,
	MenuIcon,
	PackageIcon,
	ReceiptIcon,
	SettingsIcon,
	TagIcon,
	UsersIcon,
} from "~/components/icons";

/**
 * Layout quản trị — tối ưu cho laptop/PC: sidebar cố định, bảng nhiều cột,
 * biểu mẫu hai cột. Trên màn hình nhỏ sidebar thu thành ngăn kéo để chủ shop
 * vẫn xử lý được đơn khi đang ở ngoài.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const user = await requireAdmin(db, request);

	// Dọn đơn quá hạn giữ chỗ mỗi lần chủ shop mở trang quản trị, nhờ vậy
	// số liệu tồn kho hiển thị luôn khớp thực tế mà không cần cron riêng.
	await releaseExpiredOrders(db);

	const pending = await db
		.prepare(`SELECT COUNT(*) AS total FROM orders WHERE order_status = 'pending'`)
		.first<{ total: number }>();

	return { user, pendingOrders: pending?.total ?? 0 };
}

const NAV = [
	{ to: "/admin", label: "Tổng quan", Icon: GridIcon, end: true },
	{ to: "/admin/san-pham", label: "Sản phẩm", Icon: PackageIcon, end: false },
	{ to: "/admin/don-hang", label: "Đơn hàng", Icon: ReceiptIcon, end: false, badge: true },
	{ to: "/admin/khach-hang", label: "Khách hàng", Icon: UsersIcon, end: false },
	{ to: "/admin/khuyen-mai", label: "Khuyến mãi", Icon: TagIcon, end: false },
	{ to: "/admin/bao-cao", label: "Báo cáo", Icon: ChartIcon, end: false },
	{ to: "/admin/cai-dat", label: "Cài đặt", Icon: SettingsIcon, end: false },
];

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
	const { user, pendingOrders } = loaderData;
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div className="min-h-screen bg-ink-50 lg:flex">
			{/* Thanh trên — chỉ hiện khi màn hình hẹp */}
			<header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-4 lg:hidden">
				<button
					type="button"
					onClick={() => setMenuOpen(true)}
					className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink-100"
					aria-label="Mở menu"
				>
					<MenuIcon className="h-5 w-5" />
				</button>
				<span className="font-bold text-brand-500">Lumi Admin</span>
			</header>

			{menuOpen && (
				<div className="fixed inset-0 z-50 lg:hidden">
					<button
						type="button"
						aria-label="Đóng menu"
						className="absolute inset-0 bg-ink-900/40"
						onClick={() => setMenuOpen(false)}
					/>
					<div className="absolute inset-y-0 left-0 w-64 bg-white">
						<Sidebar
							user={user}
							pendingOrders={pendingOrders}
							onNavigate={() => setMenuOpen(false)}
							onClose={() => setMenuOpen(false)}
						/>
					</div>
				</div>
			)}

			<aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-ink-200 bg-white lg:block">
				<Sidebar user={user} pendingOrders={pendingOrders} />
			</aside>

			<main className="min-w-0 flex-1 p-4 lg:p-6">
				<Outlet />
			</main>
		</div>
	);
}

function Sidebar({
	user,
	pendingOrders,
	onNavigate,
	onClose,
}: {
	user: Route.ComponentProps["loaderData"]["user"];
	pendingOrders: number;
	onNavigate?: () => void;
	onClose?: () => void;
}) {
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-14 items-center justify-between px-4 lg:h-16">
				<Link to="/admin" className="text-lg font-bold text-brand-500" onClick={onNavigate}>
					Lumi<span className="text-brand-300">*</span>{" "}
					<span className="text-sm font-medium text-ink-500">Admin</span>
				</Link>
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						className="grid h-8 w-8 place-items-center rounded-lg hover:bg-ink-100 lg:hidden"
						aria-label="Đóng"
					>
						<CloseIcon className="h-4.5 w-4.5" />
					</button>
				)}
			</div>

			<nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
				{NAV.map(({ to, label, Icon, end, badge }) => (
					<NavLink
						key={to}
						to={to}
						end={end}
						onClick={onNavigate}
						className={({ isActive }) =>
							cn(
								"flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
								isActive
									? "bg-brand-50 text-brand-600"
									: "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
							)
						}
					>
						<Icon className="h-4.5 w-4.5 shrink-0" />
						<span className="flex-1">{label}</span>
						{badge && pendingOrders > 0 && (
							<span className="badge bg-brand-500 text-white">{pendingOrders}</span>
						)}
					</NavLink>
				))}
			</nav>

			<div className="border-t border-ink-200 p-3">
				<Link
					to="/"
					onClick={onNavigate}
					className="mb-2 block rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-ink-50"
				>
					← Xem trang bán hàng
				</Link>
				<div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
					<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-600">
						{user.display_name.charAt(0).toUpperCase()}
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-medium text-ink-800">
							{user.display_name}
						</span>
						<span className="block text-xs text-ink-400">
							{user.role === "owner" ? "Chủ shop" : "Nhân viên"}
						</span>
					</span>
					<Form method="post" action="/admin/dang-xuat">
						<button
							type="submit"
							className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
							aria-label="Đăng xuất"
							title="Đăng xuất"
						>
							<LogoutIcon className="h-4.5 w-4.5" />
						</button>
					</Form>
				</div>
			</div>
		</div>
	);
}
