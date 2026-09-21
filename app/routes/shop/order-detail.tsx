import { Link, redirect } from "react-router";
import type { Route } from "./+types/order-detail";
import { CheckIcon, PackageIcon, TruckIcon } from "~/components/icons";
import { getOrderByCode } from "~/lib/db.server";
import { releaseExpiredOrders } from "~/lib/order.server";
import { canViewOrder } from "~/lib/recent-orders.server";
import { getSettings, vietQrImageUrl } from "~/lib/settings.server";
import { cn, formatDateTime, formatVnd } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import {
	ORDER_STATUS_LABEL,
	PAYMENT_METHOD_LABEL,
	PAYMENT_STATUS_LABEL,
	type OrderStatus,
} from "~/lib/types";

export function meta({ params }: Route.MetaArgs) {
	return [
		{ title: `Đơn hàng ${params.code} — Lumi` },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	await releaseExpiredOrders(db);

	const code = params.code.toUpperCase();

	// Chỉ người vừa đặt (hoặc đã xác minh SĐT ở trang tra cứu) mới xem được.
	if (!(await canViewOrder(request, code))) {
		throw redirect(`/tra-cuu-don-hang?ma=${encodeURIComponent(code)}`);
	}

	const order = await getOrderByCode(db, code);
	if (!order) throw new Response("Không tìm thấy đơn hàng", { status: 404 });

	const settings = await getSettings(db);
	const awaitingTransfer =
		order.payment_status === "pending" && order.order_status !== "cancelled";

	return {
		order,
		settings: {
			bank_id: settings.bank_id,
			bank_account_no: settings.bank_account_no,
			bank_account_name: settings.bank_account_name,
			momo_phone: settings.momo_phone,
			momo_name: settings.momo_name,
			momo_qr_key: settings.momo_qr_key,
			shop_phone: settings.shop_phone,
		},
		vietQrUrl:
			awaitingTransfer && order.payment_method === "bank_transfer"
				? vietQrImageUrl(settings, order.total, order.order_code)
				: null,
	};
}

const STATUS_STEPS: OrderStatus[] = ["pending", "confirmed", "shipping", "delivered"];

export default function OrderDetail({ loaderData }: Route.ComponentProps) {
	const { order, settings, vietQrUrl } = loaderData;
	const cancelled = order.order_status === "cancelled";
	const currentStep = STATUS_STEPS.indexOf(order.order_status as OrderStatus);
	const awaitingPayment =
		order.payment_status === "pending" &&
		!cancelled &&
		order.payment_method !== "cod";

	return (
		<div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
			{/* Đầu trang xác nhận */}
			<div className="text-center">
				<span
					className={cn(
						"mx-auto grid h-14 w-14 place-items-center rounded-full",
						cancelled ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600",
					)}
				>
					{cancelled ? (
						<span className="text-2xl">✕</span>
					) : (
						<CheckIcon className="h-7 w-7" />
					)}
				</span>
				<h1 className="mt-3 text-xl font-bold text-ink-900 md:text-2xl">
					{cancelled ? "Đơn hàng đã huỷ" : "Đặt hàng thành công!"}
				</h1>
				<p className="mt-1 text-sm text-ink-500">
					Mã đơn của bạn là{" "}
					<strong className="font-semibold text-brand-600">{order.order_code}</strong>
					{" · "}
					{formatDateTime(order.created_at)}
				</p>
			</div>

			{/* Hướng dẫn thanh toán — phần quan trọng nhất nên đặt ngay trên cùng */}
			{awaitingPayment && (
				<section className="card mt-6 border-brand-200 bg-brand-50/50 p-4 md:p-5">
					<h2 className="font-semibold text-ink-900">
						{order.payment_method === "bank_transfer"
							? "Chuyển khoản để hoàn tất đơn"
							: "Thanh toán qua MoMo"}
					</h2>
					<p className="mt-1 text-sm text-ink-600">
						Vui lòng chuyển đúng số tiền và giữ nguyên nội dung{" "}
						<strong>{order.order_code}</strong> để shop đối soát nhanh.
					</p>

					<div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
						{vietQrUrl && (
							<img
								src={vietQrUrl}
								alt={`Mã QR chuyển khoản đơn ${order.order_code}`}
								className="h-56 w-56 shrink-0 rounded-xl bg-white p-2 shadow-sm"
							/>
						)}
						{order.payment_method === "momo" && settings.momo_qr_key && (
							<img
								src={imageUrl(settings.momo_qr_key) ?? IMAGE_PLACEHOLDER}
								alt="Mã QR MoMo"
								className="h-56 w-56 shrink-0 rounded-xl bg-white p-2 shadow-sm"
							/>
						)}

						<dl className="w-full space-y-2 text-sm">
							{order.payment_method === "bank_transfer" ? (
								<>
									<InfoRow label="Ngân hàng" value={settings.bank_id} />
									<InfoRow label="Số tài khoản" value={settings.bank_account_no} copyable />
									<InfoRow label="Chủ tài khoản" value={settings.bank_account_name} />
								</>
							) : (
								<>
									<InfoRow label="Số MoMo" value={settings.momo_phone} copyable />
									<InfoRow label="Tên người nhận" value={settings.momo_name} />
								</>
							)}
							<InfoRow label="Số tiền" value={formatVnd(order.total)} highlight />
							<InfoRow label="Nội dung" value={order.order_code} copyable highlight />
						</dl>
					</div>

					{order.reserved_until && (
						<p className="mt-3 text-xs text-brand-700">
							Đơn được giữ hàng đến {formatDateTime(order.reserved_until)}. Quá thời gian
							này mà chưa nhận được thanh toán, đơn sẽ tự huỷ và hàng được trả lại kho.
						</p>
					)}
				</section>
			)}

			{/* Tiến trình đơn */}
			{!cancelled && (
				<section className="card mt-5 p-4 md:p-5">
					<ol className="flex items-center">
						{STATUS_STEPS.map((step, index) => {
							const reached = index <= currentStep;
							const Icon =
								step === "shipping" ? TruckIcon : step === "delivered" ? CheckIcon : PackageIcon;
							return (
								<li key={step} className="flex flex-1 items-center last:flex-none">
									<div className="flex flex-col items-center gap-1">
										<span
											className={cn(
												"grid h-9 w-9 place-items-center rounded-full",
												reached ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-400",
											)}
										>
											<Icon className="h-4.5 w-4.5" />
										</span>
										<span
											className={cn(
												"whitespace-nowrap text-[11px] font-medium",
												reached ? "text-brand-600" : "text-ink-400",
											)}
										>
											{ORDER_STATUS_LABEL[step]}
										</span>
									</div>
									{index < STATUS_STEPS.length - 1 && (
										<span
											className={cn(
												"mx-1 -mt-5 h-0.5 flex-1",
												index < currentStep ? "bg-brand-500" : "bg-ink-200",
											)}
										/>
									)}
								</li>
							);
						})}
					</ol>
				</section>
			)}

			{/* Thông tin nhận hàng */}
			<section className="card mt-5 p-4 md:p-5">
				<h2 className="mb-3 font-semibold text-ink-900">Thông tin nhận hàng</h2>
				<dl className="space-y-2 text-sm">
					<InfoRow label="Người nhận" value={order.customer_name} />
					<InfoRow label="Điện thoại" value={order.customer_phone} />
					<InfoRow label="Địa chỉ" value={order.customer_address} />
					<InfoRow label="Thanh toán" value={PAYMENT_METHOD_LABEL[order.payment_method]} />
					<InfoRow
						label="Trạng thái thanh toán"
						value={PAYMENT_STATUS_LABEL[order.payment_status]}
					/>
					{order.note && <InfoRow label="Ghi chú" value={order.note} />}
				</dl>
			</section>

			{/* Sản phẩm */}
			<section className="card mt-5 p-4 md:p-5">
				<h2 className="mb-3 font-semibold text-ink-900">Sản phẩm</h2>
				<ul className="divide-y divide-ink-100">
					{order.items.map((item) => (
						<li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
							<div className="aspect-4/5 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-100">
								<img
									src={imageUrl(item.image_r2_key) ?? IMAGE_PLACEHOLDER}
									alt=""
									className="h-full w-full object-cover"
								/>
							</div>
							<div className="min-w-0 flex-1">
								{item.product_slug ? (
									<Link
										to={`/san-pham/${item.product_slug}`}
										className="line-clamp-2 text-sm font-medium text-ink-800 hover:text-brand-600"
									>
										{item.product_name}
									</Link>
								) : (
									<p className="line-clamp-2 text-sm font-medium text-ink-800">
										{item.product_name}
									</p>
								)}
								<p className="mt-0.5 text-xs text-ink-500">
									Size {item.size}
									{item.color && ` | ${item.color}`} × {item.quantity}
								</p>
							</div>
							<p className="shrink-0 text-sm font-semibold text-ink-800">
								{formatVnd(item.line_total)}
							</p>
						</li>
					))}
				</ul>

				<dl className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
					<div className="flex justify-between">
						<dt className="text-ink-500">Tạm tính</dt>
						<dd className="text-ink-800">{formatVnd(order.subtotal)}</dd>
					</div>
					{order.discount_amount > 0 && (
						<div className="flex justify-between">
							<dt className="text-ink-500">Giảm giá ({order.discount_code})</dt>
							<dd className="text-green-600">-{formatVnd(order.discount_amount)}</dd>
						</div>
					)}
					<div className="flex justify-between">
						<dt className="text-ink-500">Phí vận chuyển</dt>
						<dd className="text-ink-800">
							{order.shipping_fee === 0 ? "Miễn phí" : formatVnd(order.shipping_fee)}
						</dd>
					</div>
					<div className="flex items-baseline justify-between border-t border-ink-100 pt-3">
						<dt className="font-semibold text-ink-800">Tổng cộng</dt>
						<dd className="text-lg font-bold text-brand-600">{formatVnd(order.total)}</dd>
					</div>
				</dl>
			</section>

			<div className="mt-6 flex flex-wrap justify-center gap-3">
				<Link to="/san-pham" className="btn-outline btn-md">
					Tiếp tục mua sắm
				</Link>
				{settings.shop_phone && (
					<a href={`tel:${settings.shop_phone}`} className="btn-ghost btn-md">
						Gọi shop: {settings.shop_phone}
					</a>
				)}
			</div>
		</div>
	);
}

function InfoRow({
	label,
	value,
	highlight,
	copyable,
}: {
	label: string;
	value: string | null;
	highlight?: boolean;
	copyable?: boolean;
}) {
	if (!value) return null;
	return (
		<div className="flex justify-between gap-4">
			<dt className="shrink-0 text-ink-500">{label}</dt>
			<dd
				className={cn(
					"text-right",
					highlight ? "font-bold text-brand-600" : "font-medium text-ink-800",
					copyable && "select-all",
				)}
			>
				{value}
			</dd>
		</div>
	);
}
