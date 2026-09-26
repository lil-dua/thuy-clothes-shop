import { Form, Link, NavLink, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import { getAdminUser } from "~/lib/auth.server";
import { cartCount, readCart } from "~/lib/cart.server";
import { getCategories } from "~/lib/db.server";
import { getSettings } from "~/lib/settings.server";
import { TARGET_GROUPS, type Category, type TargetGroup } from "~/lib/types";
import { cn } from "~/lib/format";
import {
	CartIcon,
	ChatIcon,
	ChevronDownIcon,
	GridIcon,
	HomeIcon,
	ReceiptIcon,
	SearchIcon,
	SettingsIcon,
} from "~/components/icons";

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const [categories, settings, admin, cart] = await Promise.all([
		getCategories(db),
		getSettings(db),
		getAdminUser(db, request),
		readCart(request),
	]);

	return {
		categories,
		shopName: settings.shop_name,
		shopTagline: settings.shop_tagline,
		shopPhone: settings.shop_phone,
		threadsHandle: settings.threads_handle,
		returnDays: settings.return_policy_days,
		cartCount: cartCount(cart),
		// Dùng để hiện lối tắt sang trang quản trị khi chủ shop đang đăng nhập
		adminName: admin?.display_name ?? null,
	};
}

export default function ShopLayout({ loaderData }: Route.ComponentProps) {
	const { categories, shopName, cartCount, adminName } = loaderData;

	return (
		/* pb-20 chừa chỗ cho thanh điều hướng dưới trên mobile. Phải đặt ở bọc
		   ngoài chứ không phải <main>, nếu không thanh này che mất dòng cuối
		   của footer. */
		<div className="flex min-h-screen flex-col bg-white pb-20 md:pb-0">
			{adminName && <AdminBar name={adminName} />}
			<Header shopName={shopName} categories={categories} cartCount={cartCount} />

			<main className="flex-1">
				<Outlet />
			</main>

			<Footer loaderData={loaderData} />
			<ZaloButton phone={loaderData.shopPhone} />
			<MobileTabBar cartCount={cartCount} />
		</div>
	);
}

/**
 * Nút nhắn Zalo nổi ở góc.
 *
 * Khách Việt quen hỏi size, chất vải, còn hàng không trước khi đặt. Không có
 * chỗ nhắn thì họ bỏ đi chứ không tự mò. zalo.me/<số điện thoại> mở thẳng cửa
 * sổ chat, không tốn gì và không cần Official Account.
 *
 * Ẩn khi chủ shop chưa điền hotline trong Cài đặt.
 */
function ZaloButton({ phone }: { phone: string }) {
	if (!phone.trim()) return null;

	return (
		<a
			href={`https://zalo.me/${phone.replace(/[^\d]/g, "")}`}
			target="_blank"
			rel="noreferrer noopener"
			aria-label="Nhắn Zalo cho shop"
			// Lệch phải để không đụng nút Bộ lọc nằm giữa ở trang danh sách.
			//
			// Mặc định nằm cao để vượt qua cả thanh mua hàng dính đáy của trang chi
			// tiết sản phẩm; app.css hạ xuống sát thanh tab ở những trang không có
			// thanh đó. Chọn chiều an toàn làm mặc định: trình duyệt cũ không hiểu
			// :has() thì nút chỉ hơi cao, chứ không che mất nút "Mua ngay".
			className="zalo-fab fixed bottom-36 right-4 z-30 flex items-center gap-2 rounded-full bg-[#0068FF] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#0068FF]/30 transition-transform hover:scale-105 md:bottom-6"
		>
			<ChatIcon className="h-5 w-5" />
			<span className="max-md:sr-only">Nhắn Zalo</span>
		</a>
	);
}

/** Dải nhắc chủ shop đang đăng nhập — đây là cách chuyển sang giao diện quản trị */
function AdminBar({ name }: { name: string }) {
	return (
		<div className="bg-ink-800 px-4 py-2 text-xs text-white">
			<div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
				<span className="truncate">
					Đang đăng nhập quản trị: <strong className="font-semibold">{name}</strong>
				</span>
				<Link
					to="/admin"
					className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"
				>
					<SettingsIcon className="h-3.5 w-3.5" />
					Trang quản trị
				</Link>
			</div>
		</div>
	);
}

function Header({
	shopName,
	categories,
	cartCount,
}: {
	shopName: string;
	categories: Category[];
	cartCount: number;
}) {
	const location = useLocation();

	return (
		<header className="sticky top-0 z-40 border-b border-ink-100 bg-white/95 backdrop-blur">
			<div className="mx-auto max-w-7xl px-4">
				<div className="flex h-14 items-center gap-3 md:h-16 md:gap-6">
					<Link to="/" className="shrink-0 text-2xl font-bold tracking-tight text-brand-500">
						{shopName}
						<span className="text-brand-300">*</span>
					</Link>

					{/* Điều hướng desktop */}
					<nav className="hidden items-center gap-1 md:flex">
						<TopLink to="/">Trang chủ</TopLink>
						{(Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => (
							<GroupMenu
								key={group}
								group={group}
								categories={categories.filter((c) => c.target_group === group)}
							/>
						))}
						<TopLink to="/san-pham">Tất cả</TopLink>
						<TopLink to="/tra-cuu-don-hang">Tra cứu đơn</TopLink>
					</nav>

					{/* Ô tìm kiếm — desktop hiện luôn, mobile nằm ở hàng dưới */}
					<Form
						action="/san-pham"
						method="get"
						className="ml-auto hidden max-w-xs flex-1 md:block"
					>
						<div className="relative">
							<SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
							<input
								type="search"
								name="q"
								defaultValue={new URLSearchParams(location.search).get("q") ?? ""}
								placeholder="Tìm sản phẩm..."
								className="field !py-2 pl-9 text-sm"
								aria-label="Tìm sản phẩm"
							/>
						</div>
					</Form>

					<Link
						to="/gio-hang"
						className="relative ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-700 hover:bg-brand-50 md:ml-0"
						aria-label={`Giỏ hàng, ${cartCount} sản phẩm`}
					>
						<CartIcon className="h-5.5 w-5.5" />
						{cartCount > 0 && (
							<span className="absolute right-0.5 top-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
								{cartCount > 99 ? "99+" : cartCount}
							</span>
						)}
					</Link>
				</div>

				{/* Hàng tìm kiếm riêng trên mobile — ngón tay chạm dễ hơn icon nhỏ */}
				<Form action="/san-pham" method="get" className="pb-2.5 md:hidden">
					<div className="relative">
						<SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
						<input
							type="search"
							name="q"
							defaultValue={new URLSearchParams(location.search).get("q") ?? ""}
							placeholder="Tìm sản phẩm..."
							className="field !rounded-full !bg-ink-50 !py-2 pl-9 text-sm"
							aria-label="Tìm sản phẩm"
						/>
					</div>
				</Form>
			</div>
		</header>
	);
}

function TopLink({ to, children }: { to: string; children: React.ReactNode }) {
	return (
		<NavLink
			to={to}
			end={to === "/"}
			className={({ isActive }) =>
				cn(
					"rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
					isActive ? "bg-brand-50 text-brand-600" : "text-ink-600 hover:text-brand-500",
				)
			}
		>
			{children}
		</NavLink>
	);
}

/**
 * Menu thả xuống cho từng nhóm đối tượng (Nữ / Trẻ em).
 * Mở bằng hover + focus-within nên vẫn dùng được bằng bàn phím và không cần JS.
 */
function GroupMenu({ group, categories }: { group: TargetGroup; categories: Category[] }) {
	const { label, slug } = TARGET_GROUPS[group];
	return (
		<div className="group relative">
			<NavLink
				to={`/${slug}`}
				className={({ isActive }) =>
					cn(
						"flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
						isActive ? "bg-brand-50 text-brand-600" : "text-ink-600 hover:text-brand-500",
					)
				}
			>
				{label}
				{categories.length > 0 && <ChevronDownIcon className="h-3.5 w-3.5" />}
			</NavLink>

			{categories.length > 0 && (
				<div className="invisible absolute left-0 top-full z-50 w-52 pt-1 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
					<div className="card overflow-hidden py-1.5 shadow-lg shadow-ink-900/5">
						{categories.map((category) => (
							<Link
								key={category.id}
								to={`/danh-muc/${category.slug}`}
								className="block px-4 py-2 text-sm text-ink-600 hover:bg-brand-50 hover:text-brand-600"
							>
								{category.name}
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Thanh điều hướng dưới cùng — chỉ hiện trên mobile.
 * Khách không cần tài khoản nên ô thứ tư là "Đơn hàng" (tra cứu bằng mã)
 * thay vì "Tài khoản".
 */
function MobileTabBar({ cartCount }: { cartCount: number }) {
	const tabs = [
		{ to: "/", label: "Trang chủ", Icon: HomeIcon, end: true },
		{ to: "/san-pham", label: "Danh mục", Icon: GridIcon, end: false },
		{ to: "/gio-hang", label: "Giỏ hàng", Icon: CartIcon, end: false, badge: cartCount },
		{ to: "/tra-cuu-don-hang", label: "Đơn hàng", Icon: ReceiptIcon, end: false },
	];

	return (
		<nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white md:hidden">
			<div className="grid grid-cols-4">
				{tabs.map(({ to, label, Icon, end, badge }) => (
					<NavLink
						key={to}
						to={to}
						end={end}
						className={({ isActive }) =>
							cn(
								"flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
								isActive ? "text-brand-500" : "text-ink-400",
							)
						}
					>
						<span className="relative">
							<Icon className="h-5.5 w-5.5" />
							{badge ? (
								<span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">
									{badge > 9 ? "9+" : badge}
								</span>
							) : null}
						</span>
						{label}
					</NavLink>
				))}
			</div>
		</nav>
	);
}

function Footer({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
	const { shopName, shopTagline, shopPhone, threadsHandle, categories, returnDays } =
		loaderData;

	return (
		<footer className="mt-12 border-t border-ink-100 bg-ink-50">
			<div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
				<div className="sm:col-span-2 lg:col-span-1">
					<p className="text-xl font-bold text-brand-500">
						{shopName}
						<span className="text-brand-300">*</span>
					</p>
					<p className="mt-2 max-w-xs text-sm text-ink-500">{shopTagline}</p>
					{shopPhone && (
						<p className="mt-3 text-sm text-ink-600">
							Hotline:{" "}
							<a href={`tel:${shopPhone}`} className="font-semibold text-brand-600">
								{shopPhone}
							</a>
						</p>
					)}
					{threadsHandle && (
						<a
							href={`https://www.threads.net/@${threadsHandle.replace("@", "")}`}
							target="_blank"
							rel="noreferrer noopener"
							className="mt-1 inline-block text-sm text-ink-600 hover:text-brand-600"
						>
							Threads: @{threadsHandle.replace("@", "")}
						</a>
					)}
				</div>

				{(Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => (
					<div key={group}>
						<p className="mb-3 text-sm font-semibold text-ink-800">
							{TARGET_GROUPS[group].label}
						</p>
						<ul className="space-y-2 text-sm text-ink-500">
							{categories
								.filter((c) => c.target_group === group)
								.slice(0, 6)
								.map((category) => (
									<li key={category.id}>
										<Link
											to={`/danh-muc/${category.slug}`}
											className="hover:text-brand-600"
										>
											{category.name}
										</Link>
									</li>
								))}
						</ul>
					</div>
				))}

				<div>
					<p className="mb-3 text-sm font-semibold text-ink-800">Hỗ trợ</p>
					<ul className="space-y-2 text-sm text-ink-500">
						<li>
							<Link to="/tra-cuu-don-hang" className="hover:text-brand-600">
								Tra cứu đơn hàng
							</Link>
						</li>
						<li>
							<Link to="/chinh-sach/doi-tra" className="hover:text-brand-600">
								Đổi trả trong {returnDays} ngày
							</Link>
						</li>
						<li>
							<Link to="/chinh-sach/van-chuyen" className="hover:text-brand-600">
								Vận chuyển & thanh toán
							</Link>
						</li>
						<li>
							<Link to="/chinh-sach/bao-mat" className="hover:text-brand-600">
								Chính sách bảo mật
							</Link>
						</li>
					</ul>
				</div>
			</div>

			<div className="border-t border-ink-200 px-4 py-4 text-center text-xs text-ink-400">
				© {new Date().getFullYear()} {shopName}. Đã đăng ký bản quyền.
			</div>
		</footer>
	);
}
