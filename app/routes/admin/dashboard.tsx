import { Form, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import {
	EmptyState,
	OrderStatusBadge,
	PageHeader,
	RevenueChart,
	StatCard,
	TableWrap,
} from "~/components/admin/ui";
import { AlertIcon, ChevronRightIcon } from "~/components/icons";
import { listOrders } from "~/lib/db.server";
import {
	currentMonth,
	getLowStockVariants,
	getPeriodStats,
	getRevenueByDay,
	getRevenueByTargetGroup,
	getTopProducts,
	monthRange,
	percentChange,
	previousMonth,
} from "~/lib/stats.server";
import { formatDateTime, formatVnd } from "~/lib/format";
import { getUpcomingPosts } from "~/lib/threads.server";
import { TARGET_GROUPS, type TargetGroup } from "~/lib/types";

export function meta() {
	return [{ title: "Tổng quan — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const url = new URL(request.url);

	const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("thang") ?? "")
		? url.searchParams.get("thang")!
		: currentMonth();
	const range = monthRange(month);
	const prevRange = monthRange(previousMonth(month));

	const [
		stats,
		prevStats,
		revenueByDay,
		topProducts,
		byGroup,
		recentOrders,
		lowStock,
		upcomingPosts,
	] = await Promise.all([
			getPeriodStats(db, range.from, range.to),
			getPeriodStats(db, prevRange.from, prevRange.to),
			getRevenueByDay(db, range.from, range.to),
			getTopProducts(db, range.from, range.to, 5),
			getRevenueByTargetGroup(db, range.from, range.to),
			listOrders(db, { perPage: 8 }),
			getLowStockVariants(db, 3, 8),
			getUpcomingPosts(db, 5),
		]);

	return {
		month,
		stats,
		changes: {
			revenue: percentChange(stats.revenue, prevStats.revenue),
			orders: percentChange(stats.orderCount, prevStats.orderCount),
			customers: percentChange(stats.newCustomers, prevStats.newCustomers),
		},
		revenueByDay,
		topProducts,
		byGroup,
		recentOrders: recentOrders.items,
		lowStock,
		upcomingPosts,
	};
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const {
		month,
		stats,
		changes,
		revenueByDay,
		topProducts,
		byGroup,
		recentOrders,
		lowStock,
		upcomingPosts,
	} = loaderData;

	return (
		<>
			<PageHeader
				title="Tổng quan"
				description="Doanh thu, đơn hàng và tồn kho trong kỳ"
				action={
					<Form method="get" className="flex items-center gap-2">
						<label htmlFor="thang" className="text-sm text-ink-500">
							Tháng
						</label>
						<input
							id="thang"
							type="month"
							name="thang"
							defaultValue={month}
							className="field !w-auto !py-1.5 text-sm"
						/>
						<button type="submit" className="btn-outline btn-sm">
							Xem
						</button>
					</Form>
				}
			/>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard
					label="Tổng doanh thu"
					value={formatVnd(stats.revenue)}
					change={changes.revenue}
				/>
				<StatCard
					label="Lợi nhuận ước tính"
					value={formatVnd(stats.profit)}
					hint="Giá bán trừ giá nhập, đã trừ tiền giảm giá"
				/>
				<StatCard
					label="Đơn hàng"
					value={String(stats.orderCount)}
					change={changes.orders}
				/>
				<StatCard
					label="Khách hàng mới"
					value={String(stats.newCustomers)}
					change={changes.customers}
				/>
			</div>

			{lowStock.length > 0 && (
				<div className="card mt-4 border-amber-200 bg-amber-50/60 p-4">
					<p className="flex items-center gap-2 font-medium text-amber-800">
						<AlertIcon className="h-4.5 w-4.5" />
						{lowStock.length} size sắp hết hàng
					</p>
					<ul className="mt-2 flex flex-wrap gap-2">
						{lowStock.map((variant) => (
							<li key={variant.variant_id}>
								<Link
									to={`/admin/san-pham/${variant.product_id}`}
									className="chip !border-amber-300 !bg-white text-xs"
								>
									{variant.product_name} · {variant.size}
									{variant.color && ` · ${variant.color}`}
									<strong className="ml-1.5 text-amber-700">
										còn {variant.quantity}
									</strong>
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}

			{upcomingPosts.length > 0 && (
				<div className="card mt-4 border-blue-200 bg-blue-50/50 p-4">
					<p className="font-medium text-blue-900">
						{upcomingPosts.length} bài Threads đang chờ tới giờ đăng
					</p>
					<ul className="mt-2 space-y-1.5">
						{upcomingPosts.map((post) => (
							<li key={post.id} className="flex flex-wrap items-baseline gap-2 text-sm">
								<span className="font-semibold text-blue-800">
									{formatDateTime(post.scheduled_at)}
								</span>
								{post.product_id ? (
									<Link
										to={`/admin/san-pham/${post.product_id}`}
										className="text-ink-700 hover:text-brand-600"
									>
										{post.product_name ?? "Sản phẩm đã xoá"}
									</Link>
								) : (
									<span className="text-ink-500">Sản phẩm đã xoá</span>
								)}
								{post.media_count > 0 && (
									<span className="text-xs text-ink-400">{post.media_count} ảnh</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className="mt-4 grid gap-4 xl:grid-cols-3">
				<section className="card p-4 xl:col-span-2">
					<h2 className="mb-2 font-semibold text-ink-900">Doanh thu theo ngày</h2>
					<RevenueChart points={revenueByDay} />
				</section>

				<section className="card p-4">
					<h2 className="font-semibold text-ink-900">Tiền hàng theo nhóm</h2>
					<p className="mb-3 text-xs text-ink-400">Giá trị sản phẩm, chưa trừ giảm giá và phí ship</p>
					<GroupBreakdown byGroup={byGroup} total={stats.revenue} />

					<h2 className="mb-3 mt-6 font-semibold text-ink-900">Bán chạy trong kỳ</h2>
					{topProducts.length === 0 ? (
						<p className="text-sm text-ink-400">Chưa có sản phẩm nào bán ra.</p>
					) : (
						<ol className="space-y-2.5">
							{topProducts.map((product, index) => (
								<li key={product.product_name} className="flex items-center gap-2.5">
									<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">
										{index + 1}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm text-ink-800">
											{product.product_name}
										</span>
										<span className="text-xs text-ink-400">
											{product.quantity} sp · {formatVnd(product.revenue)}
										</span>
									</span>
								</li>
							))}
						</ol>
					)}
				</section>
			</div>

			<section className="mt-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="font-semibold text-ink-900">Đơn hàng gần đây</h2>
					<Link
						to="/admin/don-hang"
						className="flex items-center gap-0.5 text-sm font-medium text-brand-600"
					>
						Xem tất cả
						<ChevronRightIcon className="h-4 w-4" />
					</Link>
				</div>

				<TableWrap>
					{recentOrders.length === 0 ? (
						<EmptyState
							title="Chưa có đơn hàng nào"
							description="Đơn khách đặt trên website sẽ hiện ở đây."
						/>
					) : (
						<table className="w-full text-sm">
							<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Mã đơn</th>
									<th className="px-4 py-2.5 font-semibold">Khách hàng</th>
									<th className="px-4 py-2.5 text-right font-semibold">Tổng tiền</th>
									<th className="px-4 py-2.5 font-semibold">Trạng thái</th>
									<th className="px-4 py-2.5 font-semibold">Thời gian</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-ink-100">
								{recentOrders.map((order) => (
									<tr key={order.id} className="hover:bg-ink-50/60">
										<td className="px-4 py-2.5">
											<Link
												to={`/admin/don-hang/${order.id}`}
												className="font-medium text-brand-600 hover:underline"
											>
												#{order.order_code}
											</Link>
										</td>
										<td className="px-4 py-2.5">
											<span className="block text-ink-800">{order.customer_name}</span>
											<span className="text-xs text-ink-400">{order.customer_phone}</span>
										</td>
										<td className="px-4 py-2.5 text-right font-medium text-ink-800">
											{formatVnd(order.total)}
										</td>
										<td className="px-4 py-2.5">
											<OrderStatusBadge status={order.order_status} />
										</td>
										<td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">
											{formatDateTime(order.created_at)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</TableWrap>
			</section>
		</>
	);
}

/** Thanh tỉ lệ doanh thu giữa đồ nữ và đồ trẻ em */
function GroupBreakdown({
	byGroup,
	total,
}: {
	byGroup: Route.ComponentProps["loaderData"]["byGroup"];
	total: number;
}) {
	const rows = (Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => {
		const row = byGroup.find((item) => item.target_group === group);
		return {
			group,
			label: TARGET_GROUPS[group].label,
			revenue: row?.revenue ?? 0,
			quantity: row?.quantity ?? 0,
		};
	});

	const max = Math.max(...rows.map((row) => row.revenue), 1);

	if (total === 0) {
		return <p className="text-sm text-ink-400">Chưa có đơn hàng nào trong kỳ này.</p>;
	}

	return (
		<ul className="space-y-3">
			{rows.map((row) => (
				<li key={row.group}>
					<div className="flex items-baseline justify-between text-sm">
						<span className="text-ink-700">{row.label}</span>
						<span className="font-medium text-ink-900">{formatVnd(row.revenue)}</span>
					</div>
					<div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
						<div
							className="h-full rounded-full bg-brand-400"
							style={{ width: `${(row.revenue / max) * 100}%` }}
						/>
					</div>
					<p className="mt-0.5 text-xs text-ink-400">{row.quantity} sản phẩm</p>
				</li>
			))}
		</ul>
	);
}
