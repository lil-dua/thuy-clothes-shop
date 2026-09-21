import { Link } from "react-router";
import type { Route } from "./+types/home";
import { ProductGrid } from "~/components/shop/product-card";
import { ChevronRightIcon, RefreshIcon, ShieldIcon, TruckIcon } from "~/components/icons";
import {
	getCategoriesWithCount,
	getFeaturedProducts,
	getNewestProducts,
} from "~/lib/db.server";
import { getSettings } from "~/lib/settings.server";
import { formatVnd } from "~/lib/format";
import { TARGET_GROUPS, type TargetGroup } from "~/lib/types";

export function meta({ data }: Route.MetaArgs) {
	const name = data?.shopName ?? "Lumi";
	return [
		{ title: `${name} — Thời trang nữ & trẻ em` },
		{
			name: "description",
			content:
				"Đầm, áo, quần và set đồ cho nữ và trẻ em. Giao hàng toàn quốc, thanh toán COD hoặc chuyển khoản.",
		},
	];
}

export async function loader({ context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const [featured, newest, categories, settings] = await Promise.all([
		getFeaturedProducts(db, 8),
		getNewestProducts(db, 8),
		getCategoriesWithCount(db),
		getSettings(db),
	]);

	return {
		featured,
		newest,
		categories,
		shopName: settings.shop_name,
		shopTagline: settings.shop_tagline,
		freeShippingThreshold: Number.parseInt(settings.free_shipping_threshold, 10) || 0,
		returnDays: settings.return_policy_days,
	};
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const {
		featured,
		newest,
		categories,
		shopTagline,
		freeShippingThreshold,
		returnDays,
	} = loaderData;

	return (
		<>
			<Hero tagline={shopTagline} />
			<TrustBar freeShippingThreshold={freeShippingThreshold} returnDays={returnDays} />

			<div className="mx-auto max-w-7xl space-y-12 px-4 py-8 md:py-10">
				<GroupSection categories={categories} />

				{featured.length > 0 && (
					<Section title="Sản phẩm nổi bật" to="/san-pham?sap-xep=ban-chay">
						<ProductGrid products={featured} />
					</Section>
				)}

				{newest.length > 0 && (
					<Section title="Hàng mới về" to="/san-pham">
						<ProductGrid products={newest} />
					</Section>
				)}
			</div>
		</>
	);
}

function Hero({ tagline }: { tagline: string }) {
	return (
		<section className="bg-gradient-to-br from-brand-100 via-brand-50 to-white">
			<div className="mx-auto max-w-7xl px-4 py-10 md:grid md:grid-cols-2 md:items-center md:gap-8 md:py-16">
				<div>
					<p className="text-sm font-semibold uppercase tracking-wider text-brand-500">
						Bộ sưu tập mới
					</p>
					<h1 className="mt-2 text-3xl font-bold leading-tight text-ink-900 md:text-5xl">
						Thời trang
						<br />
						<span className="text-brand-600">{tagline.replace(/^Thời trang\s*/i, "")}</span>
					</h1>
					<p className="mt-3 max-w-md text-ink-600">
						Đầm, áo, set đồ cho mẹ và bé — chất liệu thoáng mát, phom dáng tôn người.
					</p>
					<div className="mt-6 flex flex-wrap gap-3">
						<Link to="/san-pham" className="btn-primary btn-lg">
							Mua sắm ngay
						</Link>
						<Link to="/tre-em" className="btn-outline btn-lg">
							Đồ trẻ em
						</Link>
					</div>
				</div>

				{/* Khối trang trí thay cho ảnh banner — chưa có ảnh thật thì vẫn
				    giữ được bố cục, thay bằng <img> khi chủ shop tải banner lên. */}
				<div className="mt-8 hidden md:mt-0 md:block">
					<div className="relative aspect-4/3 overflow-hidden rounded-3xl bg-white/60">
						<div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-brand-200/70" />
						<div className="absolute bottom-6 left-8 h-32 w-32 rounded-full bg-brand-300/50" />
						<div className="absolute inset-0 grid place-items-center">
							<p className="text-center text-brand-500/70">
								<span className="block text-7xl">🌸</span>
								<span className="mt-2 block text-sm font-medium">
									Ảnh banner sẽ hiển thị ở đây
								</span>
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function TrustBar({
	freeShippingThreshold,
	returnDays,
}: {
	freeShippingThreshold: number;
	returnDays: string;
}) {
	const items = [
		{
			Icon: TruckIcon,
			title: "Miễn phí vận chuyển",
			detail:
				freeShippingThreshold > 0
					? `cho đơn từ ${formatVnd(freeShippingThreshold)}`
					: "toàn quốc",
		},
		{
			Icon: RefreshIcon,
			title: `Đổi trả trong ${returnDays} ngày`,
			detail: "dành cho sản phẩm lỗi",
		},
		{
			Icon: ShieldIcon,
			title: "Thanh toán an toàn",
			detail: "COD, chuyển khoản, MoMo",
		},
	];

	return (
		<div className="border-y border-ink-100 bg-brand-50/40">
			<div className="no-scrollbar mx-auto flex max-w-7xl gap-3 overflow-x-auto px-4 py-3 md:grid md:grid-cols-3 md:gap-6 md:py-4">
				{items.map(({ Icon, title, detail }) => (
					<div key={title} className="flex min-w-[70%] items-center gap-2.5 sm:min-w-0">
						<span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand-500">
							<Icon className="h-4.5 w-4.5" />
						</span>
						<span className="text-xs leading-tight md:text-sm">
							<span className="block font-semibold text-ink-800">{title}</span>
							<span className="text-ink-500">{detail}</span>
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

/** Hai khối lớn tách rõ đồ nữ và đồ trẻ em — trục phân loại chính của shop */
function GroupSection({
	categories,
}: {
	categories: Route.ComponentProps["loaderData"]["categories"];
}) {
	const groups: { key: TargetGroup; emoji: string; gradient: string }[] = [
		{ key: "women", emoji: "👗", gradient: "from-brand-200 to-brand-100" },
		{ key: "kids", emoji: "🧸", gradient: "from-amber-100 to-brand-50" },
	];

	return (
		<section>
			<h2 className="mb-4 text-xl font-bold text-ink-900 md:text-2xl">Mua theo nhóm</h2>
			<div className="grid gap-4 sm:grid-cols-2">
				{groups.map(({ key, emoji, gradient }) => {
					const groupCategories = categories.filter((c) => c.target_group === key);
					const total = groupCategories.reduce((sum, c) => sum + c.product_count, 0);

					return (
						<div
							key={key}
							className={`rounded-card bg-gradient-to-br ${gradient} p-5 md:p-6`}
						>
							<Link to={`/${TARGET_GROUPS[key].slug}`} className="group block">
								<span className="text-4xl">{emoji}</span>
								<h3 className="mt-2 flex items-center gap-1 text-lg font-bold text-ink-900">
									{TARGET_GROUPS[key].label}
									<ChevronRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
								</h3>
								<p className="text-sm text-ink-600">{total} sản phẩm</p>
							</Link>

							<div className="mt-4 flex flex-wrap gap-2">
								{groupCategories.slice(0, 5).map((category) => (
									<Link
										key={category.id}
										to={`/danh-muc/${category.slug}`}
										className="chip !border-white/70 !bg-white/70 !text-ink-700 hover:!bg-white"
									>
										{category.name}
									</Link>
								))}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function Section({
	title,
	to,
	children,
}: {
	title: string;
	to: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<div className="mb-4 flex items-end justify-between gap-4">
				<h2 className="text-xl font-bold text-ink-900 md:text-2xl">{title}</h2>
				<Link
					to={to}
					className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-brand-600 hover:text-brand-700"
				>
					Xem tất cả
					<ChevronRightIcon className="h-4 w-4" />
				</Link>
			</div>
			{children}
		</section>
	);
}
