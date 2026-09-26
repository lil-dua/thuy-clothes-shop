import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/orders";
import {
	EmptyState,
	OrderStatusBadge,
	PageHeader,
	Pagination,
	PaymentStatusBadge,
	TableWrap,
} from "~/components/admin/ui";
import { SearchIcon } from "~/components/icons";
import { listOrders } from "~/lib/db.server";
import { cn, formatDateTime, formatVnd } from "~/lib/format";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, type OrderStatus } from "~/lib/types";

export function meta() {
	return [{ title: "Đơn hàng — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const url = new URL(request.url);
	const orderStatus = url.searchParams.get("trang-thai") || null;

	const [result, counts] = await Promise.all([
		listOrders(db, {
			search: url.searchParams.get("q")?.trim() || null,
			orderStatus,
			paymentStatus: url.searchParams.get("thanh-toan") || null,
			page: Number.parseInt(url.searchParams.get("trang") ?? "1", 10) || 1,
			perPage: 20,
		}),
		db
			.prepare(`SELECT order_status, COUNT(*) AS total FROM orders GROUP BY order_status`)
			.all<{ order_status: OrderStatus; total: number }>(),
	]);

	return {
		...result,
		orderStatus,
		counts: Object.fromEntries(
			(counts.results ?? []).map((row) => [row.order_status, row.total]),
		) as Partial<Record<OrderStatus, number>>,
	};
}

export default function AdminOrders({ loaderData }: Route.ComponentProps) {
	const { items, total, page, perPage, counts, orderStatus } = loaderData;
	const [searchParams] = useSearchParams();

	const buildLink = (targetPage: number) => {
		const next = new URLSearchParams(searchParams);
		next.set("trang", String(targetPage));
		return `?${next.toString()}`;
	};

	const tabLink = (status: OrderStatus | null) => {
		const next = new URLSearchParams(searchParams);
		next.delete("trang");
		if (status) next.set("trang-thai", status);
		else next.delete("trang-thai");
		const query = next.toString();
		return query ? `?${query}` : ".";
	};

	const allCount = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);

	return (
		<>
			<PageHeader
				title="Đơn hàng"
				description={`${total} đơn khớp bộ lọc hiện tại`}
				action={
					<a
						href={`/admin/don-hang/xuat-csv?${searchParams.toString()}`}
						className="btn-outline btn-md"
					>
						Xuất CSV
					</a>
				}
			/>

			{/* Tab theo trạng thái — thao tác thường dùng nhất của chủ shop */}
			<div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
				<Link to={tabLink(null)} className={cn("chip", !orderStatus && "chip-active")}>
					Tất cả ({allCount})
				</Link>
				{(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((status) => (
					<Link
						key={status}
						to={tabLink(status)}
						className={cn("chip", orderStatus === status && "chip-active")}
					>
						{ORDER_STATUS_LABEL[status]} ({counts[status] ?? 0})
					</Link>
				))}
			</div>

			<Form method="get" className="mb-4 flex flex-wrap gap-2.5">
				{orderStatus && <input type="hidden" name="trang-thai" value={orderStatus} />}
				<div className="relative min-w-52 flex-1">
					<SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
					<input
						type="search"
						name="q"
						defaultValue={searchParams.get("q") ?? ""}
						placeholder="Mã đơn, tên hoặc số điện thoại khách..."
						className="field !py-2 pl-9 text-sm"
					/>
				</div>
				<select
					name="thanh-toan"
					defaultValue={searchParams.get("thanh-toan") ?? ""}
					className="field !w-auto !py-2 text-sm"
				>
					<option value="">Mọi trạng thái thanh toán</option>
					<option value="pending">Chờ thanh toán</option>
					<option value="paid">Đã thanh toán</option>
				</select>
				<button type="submit" className="btn-outline btn-md">
					Lọc
				</button>
			</Form>

			<TableWrap>
				{items.length === 0 ? (
					<EmptyState
						title="Không có đơn hàng nào"
						description="Thử đổi bộ lọc hoặc chờ khách đặt hàng."
					/>
				) : (
					<table className="w-full min-w-[56rem] text-sm">
						<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
							<tr>
								<th className="px-4 py-2.5 font-semibold">Mã đơn</th>
								<th className="px-4 py-2.5 font-semibold">Khách hàng</th>
								<th className="px-4 py-2.5 font-semibold">Thanh toán</th>
								<th className="px-4 py-2.5 text-right font-semibold">Tổng tiền</th>
								<th className="px-4 py-2.5 font-semibold">Trạng thái</th>
								<th className="px-4 py-2.5 font-semibold">Thời gian</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-ink-100">
							{items.map((order) => (
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
									<td className="px-4 py-2.5">
										<span className="block text-xs text-ink-600">
											{PAYMENT_METHOD_LABEL[order.payment_method]}
										</span>
										<PaymentStatusBadge status={order.payment_status} />
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

				<Pagination page={page} pageCount={Math.ceil(total / perPage)} buildLink={buildLink} />
			</TableWrap>
		</>
	);
}
