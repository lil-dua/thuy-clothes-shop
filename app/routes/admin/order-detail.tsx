import { Form, Link, data } from "react-router";
import type { Route } from "./+types/order-detail";
import {
	OrderStatusBadge,
	PageHeader,
	PaymentStatusBadge,
} from "~/components/admin/ui";
import { CheckIcon } from "~/components/icons";
import { getOrderById } from "~/lib/db.server";
import { markOrderPaid, updateOrderStatus } from "~/lib/order.server";
import { formatDateTime, formatVnd } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import {
	ORDER_STATUS_FLOW,
	ORDER_STATUS_LABEL,
	PAYMENT_METHOD_LABEL,
	type OrderStatus,
} from "~/lib/types";

export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: `Đơn ${data?.order.order_code ?? ""} — Lumi Admin` },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ params, context }: Route.LoaderArgs) {
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const order = await getOrderById(context.cloudflare.env.DB, id);
	if (!order) throw new Response("Không tìm thấy đơn hàng", { status: 404 });

	// Lợi nhuận tính từ snapshot giá nhập lưu trong từng dòng đơn
	const profit = order.items.reduce(
		(sum, item) => sum + (item.unit_price - item.unit_cost) * item.quantity,
		0,
	);

	return { order, profit };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const db = context.cloudflare.env.DB;
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	if (intent === "status") {
		const next = String(form.get("status") ?? "") as OrderStatus;
		const result = await updateOrderStatus(db, id, next);
		return data(result.ok ? { message: "Đã cập nhật trạng thái đơn" } : { error: result.error });
	}

	if (intent === "mark-paid") {
		const result = await markOrderPaid(db, id);
		return data(result.ok ? { message: "Đã xác nhận thanh toán" } : { error: result.error });
	}

	if (intent === "note") {
		await db
			.prepare(`UPDATE orders SET admin_note = ?2, updated_at = datetime('now') WHERE id = ?1`)
			.bind(id, String(form.get("adminNote") ?? "").trim() || null)
			.run();
		return data({ message: "Đã lưu ghi chú" });
	}

	return data({ error: "Thao tác không hợp lệ" });
}

export default function AdminOrderDetail({ loaderData, actionData }: Route.ComponentProps) {
	const { order, profit } = loaderData;
	const nextStatuses = ORDER_STATUS_FLOW[order.order_status];

	return (
		<>
			<PageHeader
				title={`Đơn #${order.order_code}`}
				description={`Đặt lúc ${formatDateTime(order.created_at)}`}
				action={
					<div className="flex gap-2">
						<Link
							to={`/admin/don-hang/${order.id}/phieu`}
							target="_blank"
							rel="noreferrer"
							className="btn-outline btn-md"
						>
							In phiếu giao hàng
						</Link>
						<Link to="/admin/don-hang" className="btn-ghost btn-md">
							← Danh sách đơn
						</Link>
					</div>
				}
			/>

			{actionData && "message" in actionData && actionData.message && (
				<p className="mb-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
					<CheckIcon className="h-4 w-4" />
					{actionData.message}
				</p>
			)}
			{actionData && "error" in actionData && actionData.error && (
				<p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
					{actionData.error}
				</p>
			)}

			<div className="grid gap-5 xl:grid-cols-3">
				<div className="space-y-5 xl:col-span-2">
					<section className="card p-4 lg:p-5">
						<h2 className="mb-3 font-semibold text-ink-900">Sản phẩm</h2>
						<ul className="divide-y divide-ink-100">
							{order.items.map((item) => (
								<li key={item.id} className="flex gap-3 py-3 first:pt-0">
									<div className="aspect-4/5 w-12 shrink-0 overflow-hidden rounded-md bg-ink-100">
										<img
											src={imageUrl(item.image_r2_key) ?? IMAGE_PLACEHOLDER}
											alt=""
											className="h-full w-full object-cover"
										/>
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-ink-800">{item.product_name}</p>
										<p className="text-xs text-ink-500">
											Size {item.size}
											{item.color && ` · ${item.color}`} · SL {item.quantity}
										</p>
										<p className="text-xs text-ink-400">
											Giá nhập {formatVnd(item.unit_cost)} → bán {formatVnd(item.unit_price)}
										</p>
									</div>
									<p className="shrink-0 text-sm font-semibold text-ink-800">
										{formatVnd(item.line_total)}
									</p>
								</li>
							))}
						</ul>

						<dl className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
							<Row label="Tạm tính" value={formatVnd(order.subtotal)} />
							{order.discount_amount > 0 && (
								<Row
									label={`Giảm giá (${order.discount_code})`}
									value={`-${formatVnd(order.discount_amount)}`}
								/>
							)}
							<Row
								label="Phí vận chuyển"
								value={order.shipping_fee === 0 ? "Miễn phí" : formatVnd(order.shipping_fee)}
							/>
							<div className="flex items-baseline justify-between border-t border-ink-100 pt-3">
								<dt className="font-semibold text-ink-800">Tổng cộng</dt>
								<dd className="text-lg font-bold text-brand-600">{formatVnd(order.total)}</dd>
							</div>
							<div className="flex items-baseline justify-between">
								<dt className="text-ink-500">Lợi nhuận ước tính</dt>
								<dd className="font-medium text-green-600">{formatVnd(profit)}</dd>
							</div>
						</dl>
					</section>

					<section className="card p-4 lg:p-5">
						<h2 className="mb-3 font-semibold text-ink-900">Ghi chú nội bộ</h2>
						<Form method="post" className="space-y-3">
							<input type="hidden" name="intent" value="note" />
							<textarea
								name="adminNote"
								rows={3}
								defaultValue={order.admin_note ?? ""}
								placeholder="Khách hẹn giao cuối tuần, đã nhắn Threads..."
								className="field"
							/>
							<button type="submit" className="btn-outline btn-sm">
								Lưu ghi chú
							</button>
						</Form>
					</section>
				</div>

				<div className="space-y-5">
					<section className="card p-4 lg:p-5">
						<h2 className="mb-3 font-semibold text-ink-900">Trạng thái</h2>
						<div className="flex flex-wrap items-center gap-2">
							<OrderStatusBadge status={order.order_status} />
							<PaymentStatusBadge status={order.payment_status} />
						</div>

						{order.payment_status === "pending" && order.order_status !== "cancelled" && (
							<Form method="post" className="mt-4">
								<input type="hidden" name="intent" value="mark-paid" />
								<button type="submit" className="btn-primary btn-md w-full">
									Xác nhận đã nhận tiền
								</button>
								<p className="mt-1.5 text-xs text-ink-400">
									Dùng sau khi đối soát chuyển khoản / MoMo. Đơn sẽ chuyển sang "Đã xác
									nhận".
								</p>
							</Form>
						)}

						{nextStatuses.length > 0 && (
							<div className="mt-4 space-y-2">
								<p className="text-xs font-medium uppercase tracking-wide text-ink-400">
									Chuyển trạng thái
								</p>
								{nextStatuses.map((status) => (
									<Form
										key={status}
										method="post"
										onSubmit={(event) => {
											if (
												status === "cancelled" &&
												!confirm("Huỷ đơn này? Hàng sẽ được hoàn lại kho.")
											) {
												event.preventDefault();
											}
										}}
									>
										<input type="hidden" name="intent" value="status" />
										<input type="hidden" name="status" value={status} />
										<button
											type="submit"
											className={
												status === "cancelled"
													? "btn-ghost btn-md w-full !text-red-600 hover:!bg-red-50"
													: "btn-outline btn-md w-full"
											}
										>
											{ORDER_STATUS_LABEL[status]}
										</button>
									</Form>
								))}
							</div>
						)}

						{order.reserved_until && order.payment_status === "pending" && (
							<p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
								Giữ hàng đến {formatDateTime(order.reserved_until)}. Quá hạn đơn tự huỷ và
								hoàn kho.
							</p>
						)}
					</section>

					<section className="card p-4 lg:p-5">
						<h2 className="mb-3 font-semibold text-ink-900">Khách hàng</h2>
						<dl className="space-y-2 text-sm">
							<Row label="Người nhận" value={order.customer_name} />
							<Row label="Điện thoại" value={order.customer_phone} />
							<Row label="Địa chỉ" value={order.customer_address} />
							<Row
								label="Phương thức"
								value={PAYMENT_METHOD_LABEL[order.payment_method]}
							/>
							{order.paid_at && (
								<Row label="Thanh toán lúc" value={formatDateTime(order.paid_at)} />
							)}
							{order.note && <Row label="Ghi chú của khách" value={order.note} />}
						</dl>
						<a
							href={`tel:${order.customer_phone}`}
							className="btn-outline btn-sm mt-4 w-full"
						>
							Gọi khách
						</a>
					</section>
				</div>
			</div>
		</>
	);
}

function Row({ label, value }: { label: string; value: string | null }) {
	if (!value) return null;
	return (
		<div className="flex justify-between gap-4">
			<dt className="shrink-0 text-ink-500">{label}</dt>
			<dd className="text-right font-medium text-ink-800">{value}</dd>
		</div>
	);
}
