import { Link } from "react-router";
import type { Route } from "./+types/order-slip";
import { getOrderById } from "~/lib/db.server";
import { getSettings } from "~/lib/settings.server";
import { formatDateTime, formatVnd } from "~/lib/format";
import { PAYMENT_METHOD_LABEL } from "~/lib/types";

/**
 * Phiếu giao hàng để in và kẹp vào gói.
 *
 * Bố cục tối giản, in vừa khổ A5 hoặc nửa A4. Số tiền COD in to nhất trang vì
 * đó là thứ người giao hàng cần đọc lướt qua là thấy — thu nhầm tiền là lỗi
 * tốn kém nhất trong khâu giao nhận.
 */
export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: `Phiếu giao ${data?.order.order_code ?? ""}` },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ params, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const [order, settings] = await Promise.all([getOrderById(db, id), getSettings(db)]);
	if (!order) throw new Response("Không tìm thấy đơn hàng", { status: 404 });

	return { order, settings };
}

export default function OrderSlip({ loaderData }: Route.ComponentProps) {
	const { order, settings } = loaderData;
	const codAmount = order.payment_status === "paid" ? 0 : order.total;

	return (
		<div className="mx-auto max-w-[148mm] bg-white p-6 text-ink-900">
			{/* Thanh thao tác — ẩn khi in */}
			<div className="mb-5 flex flex-wrap gap-2 print:hidden">
				<button type="button" onClick={() => window.print()} className="btn-primary btn-md">
					In phiếu
				</button>
				<Link to={`/admin/don-hang/${order.id}`} className="btn-ghost btn-md">
					← Quay lại đơn
				</Link>
			</div>

			<div className="border-b-2 border-ink-900 pb-3">
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-lg font-bold">{settings.shop_name}</p>
						{settings.shop_phone && (
							<p className="text-xs text-ink-600">ĐT: {settings.shop_phone}</p>
						)}
						{settings.shop_address && (
							<p className="text-xs text-ink-600">{settings.shop_address}</p>
						)}
					</div>
					<div className="text-right">
						<p className="text-xs uppercase tracking-wide text-ink-500">Phiếu giao hàng</p>
						<p className="text-lg font-bold">#{order.order_code}</p>
						<p className="text-xs text-ink-500">{formatDateTime(order.created_at)}</p>
					</div>
				</div>
			</div>

			<div className="mt-4">
				<p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
					Người nhận
				</p>
				<p className="text-base font-bold">{order.customer_name}</p>
				<p className="text-sm">{order.customer_phone}</p>
				<p className="text-sm leading-snug">{order.customer_address}</p>
				{order.note && (
					<p className="mt-1 text-sm italic text-ink-600">Ghi chú: {order.note}</p>
				)}
			</div>

			<table className="mt-4 w-full text-sm">
				<thead>
					<tr className="border-y border-ink-300 text-left text-xs uppercase text-ink-500">
						<th className="py-1.5 font-semibold">Sản phẩm</th>
						<th className="py-1.5 text-center font-semibold">SL</th>
						<th className="py-1.5 text-right font-semibold">Thành tiền</th>
					</tr>
				</thead>
				<tbody>
					{order.items.map((item) => (
						<tr key={item.id} className="border-b border-ink-100">
							<td className="py-1.5">
								{item.product_name}
								<span className="block text-xs text-ink-500">
									{item.size}
									{item.color && ` · ${item.color}`}
								</span>
							</td>
							<td className="py-1.5 text-center">{item.quantity}</td>
							<td className="py-1.5 text-right">{formatVnd(item.line_total)}</td>
						</tr>
					))}
				</tbody>
			</table>

			<table className="mt-3 w-full text-sm">
				<tbody>
					<tr>
						<td className="text-ink-600">Tạm tính</td>
						<td className="text-right">{formatVnd(order.subtotal)}</td>
					</tr>
					{order.discount_amount > 0 && (
						<tr>
							<td className="text-ink-600">Giảm giá</td>
							<td className="text-right">-{formatVnd(order.discount_amount)}</td>
						</tr>
					)}
					<tr>
						<td className="text-ink-600">Phí vận chuyển</td>
						<td className="text-right">
							{order.shipping_fee === 0 ? "Miễn phí" : formatVnd(order.shipping_fee)}
						</td>
					</tr>
					<tr className="border-t border-ink-300">
						<td className="py-1 font-semibold">Tổng cộng</td>
						<td className="py-1 text-right font-semibold">{formatVnd(order.total)}</td>
					</tr>
				</tbody>
			</table>

			{/* Ô tiền thu hộ, in đậm nhất trang */}
			<div className="mt-4 border-2 border-ink-900 p-3 text-center">
				<p className="text-xs font-semibold uppercase tracking-wide">
					{codAmount > 0 ? "Thu hộ khi giao (COD)" : "Đã thanh toán trước"}
				</p>
				<p className="text-2xl font-bold">{codAmount > 0 ? formatVnd(codAmount) : "0đ"}</p>
				<p className="mt-0.5 text-xs text-ink-600">
					{PAYMENT_METHOD_LABEL[order.payment_method]}
				</p>
			</div>

			<p className="mt-4 text-center text-xs text-ink-500">
				Cảm ơn bạn đã mua hàng tại {settings.shop_name}
				{settings.return_policy_days &&
					` · Đổi trả trong ${settings.return_policy_days} ngày với sản phẩm lỗi`}
			</p>
		</div>
	);
}
