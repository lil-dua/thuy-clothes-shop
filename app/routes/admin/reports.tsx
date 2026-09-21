import { Form, Link } from "react-router";
import type { Route } from "./+types/reports";
import {
	EmptyState,
	PageHeader,
	RevenueChart,
	StatCard,
	TableWrap,
} from "~/components/admin/ui";
import {
	getLowStockVariants,
	getPeriodStats,
	getRevenueByDay,
	getRevenueByTargetGroup,
	getTopProducts,
} from "~/lib/stats.server";
import { formatVnd } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import { TARGET_GROUPS, type TargetGroup } from "~/lib/types";

export function meta() {
	return [{ title: "Báo cáo — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD */
function todayVn(offsetDays = 0): string {
	const date = new Date(Date.now() + 7 * 60 * 60 * 1000 + offsetDays * 86_400_000);
	return date.toISOString().slice(0, 10);
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const url = new URL(request.url);

	const isDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
	const from = isDate(url.searchParams.get("tu")) ? url.searchParams.get("tu")! : todayVn(-29);
	const to = isDate(url.searchParams.get("den")) ? url.searchParams.get("den")! : todayVn();

	const [stats, revenueByDay, topProducts, byGroup, lowStock] = await Promise.all([
		getPeriodStats(db, from, to),
		getRevenueByDay(db, from, to),
		getTopProducts(db, from, to, 10),
		getRevenueByTargetGroup(db, from, to),
		getLowStockVariants(db, 5, 30),
	]);

	return { from, to, stats, revenueByDay, topProducts, byGroup, lowStock };
}

export default function AdminReports({ loaderData }: Route.ComponentProps) {
	const { from, to, stats, revenueByDay, topProducts, byGroup, lowStock } = loaderData;

	const groupRows = (Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => {
		const row = byGroup.find((item) => item.target_group === group);
		return {
			group,
			label: TARGET_GROUPS[group].label,
			revenue: row?.revenue ?? 0,
			quantity: row?.quantity ?? 0,
		};
	});
	const groupTotal = groupRows.reduce((sum, row) => sum + row.revenue, 0);

	return (
		<>
			<PageHeader
				title="Báo cáo"
				description="Chọn khoảng thời gian để xem doanh thu, lợi nhuận và hàng bán chạy"
				action={
					<Form method="get" className="flex flex-wrap items-end gap-2">
						<div>
							<label htmlFor="tu" className="mb-1 block text-xs text-ink-500">
								Từ ngày
							</label>
							<input
								id="tu"
								type="date"
								name="tu"
								defaultValue={from}
								className="field !py-1.5 text-sm"
							/>
						</div>
						<div>
							<label htmlFor="den" className="mb-1 block text-xs text-ink-500">
								Đến ngày
							</label>
							<input
								id="den"
								type="date"
								name="den"
								defaultValue={to}
								className="field !py-1.5 text-sm"
							/>
						</div>
						<button type="submit" className="btn-outline btn-sm">
							Xem
						</button>
					</Form>
				}
			/>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard label="Doanh thu" value={formatVnd(stats.revenue)} />
				<StatCard
					label="Lợi nhuận"
					value={formatVnd(stats.profit)}
					hint={
						stats.revenue > 0
							? `Biên lợi nhuận ${Math.round((stats.profit / stats.revenue) * 100)}%`
							: undefined
					}
				/>
				<StatCard label="Số đơn" value={String(stats.orderCount)} />
				<StatCard label="Sản phẩm đã bán" value={String(stats.itemCount)} />
			</div>

			<section className="card mt-4 p-4">
				<h2 className="mb-2 font-semibold text-ink-900">Doanh thu theo ngày</h2>
				<RevenueChart points={revenueByDay} />
			</section>

			<div className="mt-4 grid gap-4 xl:grid-cols-3">
				<section className="card p-4">
					<h2 className="font-semibold text-ink-900">Đồ nữ và đồ trẻ em</h2>
					<p className="mb-3 text-xs text-ink-400">Tính theo tiền hàng, chưa trừ giảm giá</p>
					{groupTotal === 0 ? (
						<p className="text-sm text-ink-400">Chưa có đơn hàng nào trong khoảng này.</p>
					) : (
						<ul className="space-y-3">
							{groupRows.map((row) => (
								<li key={row.group}>
									<div className="flex items-baseline justify-between text-sm">
										<span className="text-ink-700">{row.label}</span>
										<span className="font-medium text-ink-900">
											{Math.round((row.revenue / groupTotal) * 100)}%
										</span>
									</div>
									<div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
										<div
											className="h-full rounded-full bg-brand-400"
											style={{ width: `${(row.revenue / groupTotal) * 100}%` }}
										/>
									</div>
									<p className="mt-0.5 text-xs text-ink-400">
										{formatVnd(row.revenue)} · {row.quantity} sản phẩm
									</p>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="xl:col-span-2">
					<h2 className="mb-3 font-semibold text-ink-900">Sản phẩm bán chạy</h2>
					<TableWrap>
						{topProducts.length === 0 ? (
							<EmptyState title="Chưa có sản phẩm nào bán ra trong khoảng này" />
						) : (
							<table className="w-full min-w-[34rem] text-sm">
								<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
									<tr>
										<th className="px-4 py-2.5 font-semibold">#</th>
										<th className="px-4 py-2.5 font-semibold">Sản phẩm</th>
										<th className="px-4 py-2.5 text-right font-semibold">Đã bán</th>
										<th className="px-4 py-2.5 text-right font-semibold">Doanh thu</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-ink-100">
									{topProducts.map((product, index) => (
										<tr key={product.product_name} className="hover:bg-ink-50/60">
											<td className="px-4 py-2 text-ink-400">{index + 1}</td>
											<td className="px-4 py-2">
												<div className="flex items-center gap-2.5">
													<div className="aspect-4/5 w-8 shrink-0 overflow-hidden rounded bg-ink-100">
														<img
															src={imageUrl(product.image_r2_key) ?? IMAGE_PLACEHOLDER}
															alt=""
															className="h-full w-full object-cover"
														/>
													</div>
													<span className="text-ink-800">{product.product_name}</span>
												</div>
											</td>
											<td className="px-4 py-2 text-right font-medium text-ink-800">
												{product.quantity}
											</td>
											<td className="px-4 py-2 text-right font-medium text-ink-800">
												{formatVnd(product.revenue)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</TableWrap>
				</section>
			</div>

			<section className="mt-4">
				<h2 className="mb-3 font-semibold text-ink-900">Sắp hết hàng (còn ≤ 5)</h2>
				<TableWrap>
					{lowStock.length === 0 ? (
						<EmptyState title="Tồn kho đang ổn" description="Không có size nào dưới 5 sản phẩm." />
					) : (
						<table className="w-full min-w-[34rem] text-sm">
							<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Sản phẩm</th>
									<th className="px-4 py-2.5 font-semibold">Size</th>
									<th className="px-4 py-2.5 font-semibold">Màu</th>
									<th className="px-4 py-2.5 text-right font-semibold">Còn lại</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-ink-100">
								{lowStock.map((variant) => (
									<tr key={variant.variant_id} className="hover:bg-ink-50/60">
										<td className="px-4 py-2">
											<Link
												to={`/admin/san-pham/${variant.product_id}`}
												className="font-medium text-ink-800 hover:text-brand-600"
											>
												{variant.product_name}
											</Link>
										</td>
										<td className="px-4 py-2 text-ink-600">{variant.size}</td>
										<td className="px-4 py-2 text-ink-600">{variant.color ?? "—"}</td>
										<td
											className={`px-4 py-2 text-right font-semibold ${
												variant.quantity === 0 ? "text-red-600" : "text-amber-600"
											}`}
										>
											{variant.quantity}
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
