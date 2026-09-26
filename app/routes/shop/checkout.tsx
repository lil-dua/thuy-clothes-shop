import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/checkout";
import { CheckIcon } from "~/components/icons";
import {
	cartSubtotal,
	loadCartDetails,
	readCart,
	readDiscountCode,
	serializeCart,
	serializeDiscountCode,
} from "~/lib/cart.server";
import { createOrder, releaseExpiredOrders, validateDiscountCode } from "~/lib/order.server";
import { rememberOrder } from "~/lib/recent-orders.server";
import { getSecret, getSettings, shippingFeeFor } from "~/lib/settings.server";
import { sendOrderEmails } from "~/lib/email.server";
import { getOrderByCode } from "~/lib/db.server";
import { formatVnd, isValidPhone, normalizePhone } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "~/lib/types";

export function meta() {
	return [{ title: "Thanh toán — Lumi" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	await releaseExpiredOrders(db);

	const lines = await readCart(request);
	if (lines.length === 0) throw redirect("/gio-hang");

	const [{ items }, settings, discountCode] = await Promise.all([
		loadCartDetails(db, lines),
		getSettings(db),
		readDiscountCode(request),
	]);
	if (items.length === 0) throw redirect("/gio-hang");

	const subtotal = cartSubtotal(items);
	const discount = discountCode
		? await validateDiscountCode(db, discountCode, subtotal)
		: null;
	const discountAmount = discount?.ok ? discount.amount : 0;
	const shippingFee = shippingFeeFor(settings, subtotal);

	return {
		items,
		subtotal,
		discountAmount,
		discountCode: discount?.ok ? discountCode : null,
		// Mã đang giữ trong cookie có thể mất hiệu lực khi giỏ thay đổi (tụt dưới
		// mức đơn tối thiểu, hết lượt, hết hạn). Nói rõ lý do thay vì để nó lặng
		// lẽ biến mất khỏi phần tính tiền.
		discountError: discount && !discount.ok ? discount.error : null,
		shippingFee,
		total: Math.max(0, subtotal - discountAmount + shippingFee),
		// Chỉ hiện phương thức đã được cấu hình đủ thông tin nhận tiền
		hasBankInfo: Boolean(settings.bank_id && settings.bank_account_no),
		hasMomoInfo: Boolean(settings.momo_phone || settings.momo_qr_key),
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const db = env.DB;
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "order");

	// --- Áp / bỏ mã giảm giá ----------------------------------------------
	// Mã lưu ở cookie riêng nên áp ở giỏ hàng hay ở đây đều như nhau.
	if (intent === "remove-discount") {
		return redirect("/thanh-toan", {
			headers: { "Set-Cookie": await serializeDiscountCode(null) },
		});
	}

	if (intent === "discount") {
		const code = String(form.get("code") ?? "").trim();
		const lines = await readCart(request);
		const { items } = await loadCartDetails(db, lines);
		const check = await validateDiscountCode(db, code, cartSubtotal(items));

		if (!check.ok) {
			const failure: Record<string, string> = { discount: check.error };
			return data({ errors: failure }, { status: 400 });
		}

		return redirect("/thanh-toan", {
			headers: { "Set-Cookie": await serializeDiscountCode(check.code.code) },
		});
	}

	// --- Đặt hàng ----------------------------------------------------------
	const customerName = String(form.get("customerName") ?? "").trim();
	const rawPhone = String(form.get("customerPhone") ?? "").trim();
	const customerAddress = String(form.get("customerAddress") ?? "").trim();
	const customerEmail = String(form.get("customerEmail") ?? "").trim().toLowerCase();
	const paymentMethod = String(form.get("paymentMethod") ?? "cod") as PaymentMethod;
	const note = String(form.get("note") ?? "").trim() || null;

	const errors: Record<string, string> = {};
	if (customerName.length < 2) errors.customerName = "Vui lòng nhập họ tên người nhận";
	if (!isValidPhone(rawPhone)) errors.customerPhone = "Số điện thoại không hợp lệ (10 số)";
	if (customerAddress.length < 8) errors.customerAddress = "Vui lòng nhập địa chỉ đầy đủ";
	// Email không bắt buộc, nhưng đã nhập thì phải đúng dạng — gõ sai là mất
	// luôn thư xác nhận mà khách không biết vì sao.
	if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail)) {
		errors.customerEmail = "Email không hợp lệ";
	}
	if (!["cod", "bank_transfer", "momo"].includes(paymentMethod)) {
		errors.paymentMethod = "Vui lòng chọn phương thức thanh toán";
	}
	if (Object.keys(errors).length > 0) return data({ errors }, { status: 400 });

	const [lines, settings, discountCode] = await Promise.all([
		readCart(request),
		getSettings(db),
		readDiscountCode(request),
	]);
	const { items } = await loadCartDetails(db, lines);
	if (items.length === 0) throw redirect("/gio-hang");

	const result = await createOrder(db, settings, {
		items,
		customerName,
		customerPhone: normalizePhone(rawPhone),
		customerEmail: customerEmail || null,
		customerAddress,
		paymentMethod,
		note,
		discountCode,
	});

	if (!result.ok) {
		const failure: Record<string, string> = { form: result.error };
		return data({ errors: failure }, { status: 400 });
	}

	// Gửi email chạy nền bằng waitUntil: khách không phải đợi Resend trả lời
	// mới thấy trang cảm ơn, và mail hỏng cũng không chặn được việc đặt hàng.
	const created = await getOrderByCode(db, result.orderCode);
	if (created) {
		const apiKey = await getSecret(db, "resend_api_key", env as unknown as Record<string, unknown>);
		context.cloudflare.ctx.waitUntil(
			sendOrderEmails(db, apiKey, settings, created, new URL(request.url).origin),
		);
	}

	// Đặt hàng xong thì dọn giỏ, dọn mã giảm giá, và ghi nhớ mã đơn để khách
	// xem được trang chi tiết mà không phải nhập lại số điện thoại.
	const headers = new Headers();
	headers.append("Set-Cookie", await serializeCart([]));
	headers.append("Set-Cookie", await serializeDiscountCode(null));
	headers.append("Set-Cookie", await rememberOrder(request, result.orderCode));

	return redirect(`/don-hang/${result.orderCode}`, { headers });
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
	const {
		items,
		subtotal,
		shippingFee,
		discountAmount,
		discountCode,
		total,
		hasBankInfo,
		hasMomoInfo,
	} = loaderData;
	const errors = actionData?.errors ?? {};
	const discountError = errors.discount ?? loaderData.discountError;
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";

	const methods: { value: PaymentMethod; hint: string; available: boolean }[] = [
		{ value: "cod", hint: "Trả tiền mặt khi nhận hàng", available: true },
		{
			value: "bank_transfer",
			hint: "Quét mã QR, tiền vào tài khoản ngay",
			available: hasBankInfo,
		},
		{ value: "momo", hint: "Thanh toán qua ví MoMo", available: hasMomoInfo },
	];

	return (
		<div className="mx-auto max-w-5xl px-4 py-5 md:py-8">
			<h1 className="mb-5 text-xl font-bold text-ink-900 md:text-2xl">Thanh toán</h1>

			{errors.form && (
				<p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
					{errors.form}
				</p>
			)}

			<div className="md:grid md:grid-cols-[1fr_20rem] md:items-start md:gap-6">
				<Form id="checkout-form" method="post" className="space-y-6">
					<input type="hidden" name="intent" value="order" />
					<section className="card p-4 md:p-5">
						<h2 className="mb-4 font-semibold text-ink-900">Địa chỉ giao hàng</h2>
						<div className="space-y-4">
							<Field
								label="Họ và tên người nhận"
								name="customerName"
								placeholder="Nguyễn Thị Hoa"
								error={errors.customerName}
								autoComplete="name"
								required
							/>
							<Field
								label="Số điện thoại"
								name="customerPhone"
								type="tel"
								inputMode="numeric"
								placeholder="0987 654 321"
								error={errors.customerPhone}
								autoComplete="tel"
								required
							/>
							<Field
								label="Email"
								name="customerEmail"
								type="email"
								placeholder="de-nhan-xac-nhan-don@email.com"
								error={errors.customerEmail}
								autoComplete="email"
								hint="Không bắt buộc — có email thì shop gửi xác nhận đơn cho bạn"
							/>
							<div>
								<label htmlFor="customerAddress" className="field-label">
									Địa chỉ nhận hàng <span className="text-brand-500">*</span>
								</label>
								<textarea
									id="customerAddress"
									name="customerAddress"
									rows={3}
									required
									autoComplete="street-address"
									placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
									className={`field ${errors.customerAddress ? "field-error" : ""}`}
								/>
								{errors.customerAddress && (
									<p className="mt-1 text-xs text-red-600">{errors.customerAddress}</p>
								)}
							</div>
							<div>
								<label htmlFor="note" className="field-label">
									Ghi chú <span className="text-ink-400">(không bắt buộc)</span>
								</label>
								<textarea
									id="note"
									name="note"
									rows={2}
									placeholder="Giao giờ hành chính, gọi trước khi giao..."
									className="field"
								/>
							</div>
						</div>
					</section>

					<section className="card p-4 md:p-5">
						<h2 className="mb-4 font-semibold text-ink-900">Phương thức thanh toán</h2>
						<div className="space-y-2.5">
							{methods.map(({ value, hint, available }, index) => (
								<label
									key={value}
									className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition
										${available ? "border-ink-200 hover:border-brand-300 has-checked:border-brand-500 has-checked:bg-brand-50/60" : "cursor-not-allowed border-dashed border-ink-200 opacity-50"}`}
								>
									<input
										type="radio"
										name="paymentMethod"
										value={value}
										defaultChecked={index === 0}
										disabled={!available}
										className="mt-0.5 h-4.5 w-4.5 accent-brand-500"
									/>
									<span className="min-w-0">
										<span className="block text-sm font-medium text-ink-800">
											{PAYMENT_METHOD_LABEL[value]}
										</span>
										<span className="block text-xs text-ink-500">
											{available ? hint : "Chủ shop chưa cấu hình phương thức này"}
										</span>
									</span>
								</label>
							))}
						</div>
						<p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
							<CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
							Với chuyển khoản và MoMo, đơn được giữ hàng 30 phút để bạn hoàn tất thanh
							toán.
						</p>
					</section>
				</Form>

				{/* Tóm tắt đơn hàng */}
				<aside className="mt-5 md:sticky md:top-20 md:mt-0">
					<div className="card p-4">
						<h2 className="mb-3 font-semibold text-ink-900">Sản phẩm ({items.length})</h2>
						<ul className="max-h-64 space-y-3 overflow-y-auto">
							{items.map((item) => (
								<li key={item.variantId} className="flex gap-2.5">
									<div className="aspect-4/5 w-12 shrink-0 overflow-hidden rounded-md bg-ink-100">
										<img
											src={imageUrl(item.imageKey) ?? IMAGE_PLACEHOLDER}
											alt=""
											className="h-full w-full object-cover"
										/>
									</div>
									<div className="min-w-0 flex-1 text-xs">
										<p className="line-clamp-2 font-medium text-ink-800">
											{item.productName}
										</p>
										<p className="text-ink-500">
											{item.size}
											{item.color && ` | ${item.color}`} × {item.quantity}
										</p>
									</div>
									<p className="shrink-0 text-xs font-semibold text-ink-800">
										{formatVnd(item.lineTotal)}
									</p>
								</li>
							))}
						</ul>

						{/* Ô nhập mã phải có ở đây, không chỉ ở giỏ hàng: nút "Mua ngay" ở
						    trang sản phẩm đi thẳng tới đây và bỏ qua giỏ hàng. */}
						<div className="mt-4 border-t border-ink-100 pt-4">
							{discountCode ? (
								<div className="flex items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-2">
									<span className="text-sm text-green-800">
										Đang dùng mã <strong>{discountCode}</strong>
									</span>
									<Form method="post">
										<input type="hidden" name="intent" value="remove-discount" />
										<button type="submit" className="text-xs text-ink-500 hover:text-red-600">
											Bỏ mã
										</button>
									</Form>
								</div>
							) : (
								<Form method="post">
									<input type="hidden" name="intent" value="discount" />
									<label htmlFor="code" className="field-label">
										Mã giảm giá
									</label>
									<div className="flex gap-2">
										<input
											id="code"
											name="code"
											placeholder="Nhập mã giảm giá"
											className="field !py-2 text-sm"
										/>
										<button type="submit" className="btn-outline btn-md shrink-0">
											Áp dụng
										</button>
									</div>
								</Form>
							)}
							{discountError && (
								<p className="mt-1.5 text-xs text-red-600">{discountError}</p>
							)}
						</div>

						<dl className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
							<div className="flex justify-between">
								<dt className="text-ink-500">Tổng tiền hàng</dt>
								<dd className="font-medium text-ink-800">{formatVnd(subtotal)}</dd>
							</div>
							{discountAmount > 0 && (
								<div className="flex justify-between">
									<dt className="text-ink-500">Giảm giá ({discountCode})</dt>
									<dd className="text-green-600">-{formatVnd(discountAmount)}</dd>
								</div>
							)}
							<div className="flex justify-between">
								<dt className="text-ink-500">Phí vận chuyển</dt>
								<dd className="font-medium text-ink-800">
									{shippingFee === 0 ? "Miễn phí" : formatVnd(shippingFee)}
								</dd>
							</div>
							<div className="flex items-baseline justify-between border-t border-ink-100 pt-3">
								<dt className="font-semibold text-ink-800">Tổng thanh toán</dt>
								<dd className="text-lg font-bold text-brand-600">{formatVnd(total)}</dd>
							</div>
						</dl>

						<button
							type="submit"
							form="checkout-form"
							disabled={submitting}
							className="btn-primary btn-lg mt-4 w-full"
						>
							{submitting ? "Đang xử lý..." : "Đặt hàng"}
						</button>
						<Link
							to="/gio-hang"
							className="mt-2 block text-center text-sm text-ink-500 hover:text-brand-600"
						>
							Quay lại giỏ hàng
						</Link>
					</div>
				</aside>
			</div>
		</div>
	);
}

function Field({
	label,
	name,
	error,
	required,
	hint,
	...props
}: {
	label: string;
	name: string;
	error?: string;
	hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<div>
			<label htmlFor={name} className="field-label">
				{label} {required && <span className="text-brand-500">*</span>}
			</label>
			<input
				id={name}
				name={name}
				required={required}
				className={`field ${error ? "field-error" : ""}`}
				{...props}
			/>
			{error ? (
				<p className="mt-1 text-xs text-red-600">{error}</p>
			) : (
				hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>
			)}
		</div>
	);
}
