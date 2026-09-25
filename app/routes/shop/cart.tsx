import { Form, Link, data, redirect } from "react-router";
import type { Route } from "./+types/cart";
import { CartIcon, MinusIcon, PlusIcon, TrashIcon } from "~/components/icons";
import {
	cartSubtotal,
	loadCartDetails,
	readCart,
	readDiscountCode,
	removeLine,
	serializeCart,
	serializeDiscountCode,
	setLineQuantity,
} from "~/lib/cart.server";
import { releaseExpiredOrders, validateDiscountCode } from "~/lib/order.server";
import { getSettings, shippingFeeFor } from "~/lib/settings.server";
import { formatVnd } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";

export function meta() {
	return [{ title: "Giỏ hàng — Lumi" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;

	// Trả kho cho đơn quá hạn giữ chỗ TRƯỚC khi đọc tồn, nếu không giỏ hàng có
	// thể báo "chỉ còn 1 sản phẩm" trong khi hàng đã được trả về kho từ lâu.
	await releaseExpiredOrders(db);

	const lines = await readCart(request);
	const [{ items, removed }, settings, discountCode] = await Promise.all([
		loadCartDetails(db, lines),
		getSettings(db),
		readDiscountCode(request),
	]);

	const subtotal = cartSubtotal(items);
	const discount = discountCode
		? await validateDiscountCode(db, discountCode, subtotal)
		: null;

	const discountAmount = discount?.ok ? discount.amount : 0;
	const shippingFee = shippingFeeFor(settings, subtotal);

	const headers = new Headers();
	// Có dòng trỏ tới sản phẩm đã gỡ bán — ghi lại cookie cho sạch
	if (removed) headers.append("Set-Cookie", await serializeCart(items.map((item) => ({
		variantId: item.variantId,
		quantity: item.quantity,
	}))));

	return data(
		{
			items,
			subtotal,
			shippingFee,
			discountAmount,
			discountCode: discount?.ok ? discountCode : null,
			discountError: discount && !discount.ok ? discount.error : null,
			total: Math.max(0, subtotal - discountAmount + shippingFee),
			freeShippingThreshold:
				Number.parseInt(settings.free_shipping_threshold, 10) || 0,
		},
		{ headers },
	);
}

export async function action({ request, context }: Route.ActionArgs) {
	const db = context.cloudflare.env.DB;
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	if (intent === "discount") {
		const code = String(form.get("code") ?? "").trim();
		if (!code) {
			return data(
				{ error: "Vui lòng nhập mã giảm giá" },
				{ headers: { "Set-Cookie": await serializeDiscountCode(null) } },
			);
		}
		const lines = await readCart(request);
		const { items } = await loadCartDetails(db, lines);
		const check = await validateDiscountCode(db, code, cartSubtotal(items));
		if (!check.ok) return data({ error: check.error });

		return redirect("/gio-hang", {
			headers: { "Set-Cookie": await serializeDiscountCode(check.code.code) },
		});
	}

	if (intent === "remove-discount") {
		return redirect("/gio-hang", {
			headers: { "Set-Cookie": await serializeDiscountCode(null) },
		});
	}

	const variantId = Number.parseInt(String(form.get("variantId") ?? ""), 10);
	let lines = await readCart(request);

	if (intent === "update" && Number.isInteger(variantId)) {
		lines = setLineQuantity(
			lines,
			variantId,
			Number.parseInt(String(form.get("quantity") ?? "0"), 10) || 0,
		);
	} else if (intent === "remove" && Number.isInteger(variantId)) {
		lines = removeLine(lines, variantId);
	} else if (intent === "clear") {
		lines = [];
	}

	return redirect("/gio-hang", {
		headers: { "Set-Cookie": await serializeCart(lines) },
	});
}

export default function Cart({ loaderData, actionData }: Route.ComponentProps) {
	const {
		items,
		subtotal,
		shippingFee,
		discountAmount,
		discountCode,
		total,
		freeShippingThreshold,
	} = loaderData;

	const discountError = actionData?.error ?? loaderData.discountError;

	if (items.length === 0) {
		return (
			<div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
				<CartIcon className="h-14 w-14 text-ink-300" />
				<h1 className="mt-4 text-xl font-bold text-ink-900">Giỏ hàng đang trống</h1>
				<p className="mt-1.5 text-sm text-ink-500">
					Thêm vài món bạn thích để bắt đầu đặt hàng nhé.
				</p>
				<Link to="/san-pham" className="btn-primary btn-lg mt-6">
					Khám phá sản phẩm
				</Link>
			</div>
		);
	}

	const missingForFreeShip = freeShippingThreshold - subtotal;

	return (
		<div className="mx-auto max-w-5xl px-4 py-5 md:py-8">
			<div className="mb-4 flex items-center justify-between">
				<h1 className="text-xl font-bold text-ink-900 md:text-2xl">
					Giỏ hàng ({items.length})
				</h1>
				<Form method="post">
					<input type="hidden" name="intent" value="clear" />
					<button type="submit" className="text-sm text-ink-500 hover:text-red-600">
						Xoá tất cả
					</button>
				</Form>
			</div>

			{missingForFreeShip > 0 && (
				<p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
					Mua thêm <strong>{formatVnd(missingForFreeShip)}</strong> để được miễn phí vận
					chuyển.
				</p>
			)}

			<div className="md:grid md:grid-cols-[1fr_20rem] md:items-start md:gap-6">
				<ul className="divide-y divide-ink-100 border-y border-ink-100">
					{items.map((item) => {
						const overStock = item.quantity > item.available;
						return (
							<li key={item.variantId} className="flex gap-3 py-4">
								<Link
									to={`/san-pham/${item.productSlug}`}
									className="aspect-4/5 w-20 shrink-0 overflow-hidden rounded-lg bg-ink-100"
								>
									<img
										src={imageUrl(item.imageKey) ?? IMAGE_PLACEHOLDER}
										alt={item.productName}
										className="h-full w-full object-cover"
									/>
								</Link>

								<div className="min-w-0 flex-1">
									<div className="flex items-start justify-between gap-2">
										<Link
											to={`/san-pham/${item.productSlug}`}
											className="line-clamp-2 text-sm font-medium text-ink-800 hover:text-brand-600"
										>
											{item.productName}
										</Link>
										<Form method="post" className="shrink-0">
											<input type="hidden" name="intent" value="remove" />
											<input type="hidden" name="variantId" value={item.variantId} />
											<button
												type="submit"
												className="grid h-7 w-7 place-items-center rounded-full text-ink-400 hover:bg-red-50 hover:text-red-600"
												aria-label={`Xoá ${item.productName}`}
											>
												<TrashIcon className="h-4 w-4" />
											</button>
										</Form>
									</div>

									<p className="mt-0.5 text-xs text-ink-500">
										Size: {item.size}
										{item.color && ` | Màu: ${item.color}`}
									</p>
									<p className="mt-1 text-sm font-semibold text-brand-600">
										{formatVnd(item.unitPrice)}
									</p>

									{overStock && (
										<p className="mt-1 text-xs font-medium text-red-600">
											Chỉ còn {item.available} sản phẩm — vui lòng giảm số lượng
										</p>
									)}

									<QuantityStepper
										variantId={item.variantId}
										quantity={item.quantity}
										max={item.available}
									/>
								</div>
							</li>
						);
					})}
				</ul>

				{/* Tóm tắt: cột phải trên desktop, khối dưới trên mobile */}
				<aside className="mt-5 md:sticky md:top-20 md:mt-0">
					<div className="card p-4">
						<Form method="post" className="mb-4">
							<input type="hidden" name="intent" value="discount" />
							<label htmlFor="code" className="field-label">
								Mã giảm giá
							</label>
							<div className="flex gap-2">
								<input
									id="code"
									name="code"
									defaultValue={discountCode ?? ""}
									placeholder="Nhập mã giảm giá"
									className="field !py-2 text-sm"
								/>
								<button type="submit" className="btn-outline btn-md shrink-0">
									Áp dụng
								</button>
							</div>
							{discountError && (
								<p className="mt-1.5 text-xs text-red-600">{discountError}</p>
							)}
						</Form>

						<dl className="space-y-2 border-t border-ink-100 pt-4 text-sm">
							<Row label="Tạm tính" value={formatVnd(subtotal)} />
							{discountAmount > 0 && (
								<Row
									label={`Giảm giá (${discountCode})`}
									value={`-${formatVnd(discountAmount)}`}
									accent="text-green-600"
								/>
							)}
							<Row
								label="Phí vận chuyển"
								value={shippingFee === 0 ? "Miễn phí" : formatVnd(shippingFee)}
							/>
							<div className="flex items-baseline justify-between border-t border-ink-100 pt-3">
								<dt className="font-semibold text-ink-800">Tổng cộng</dt>
								<dd className="text-lg font-bold text-brand-600">{formatVnd(total)}</dd>
							</div>
						</dl>

						<Link to="/thanh-toan" className="btn-primary btn-lg mt-4 w-full">
							Tiến hành thanh toán
						</Link>
						<Link
							to="/san-pham"
							className="mt-2 block text-center text-sm text-ink-500 hover:text-brand-600"
						>
							Tiếp tục mua sắm
						</Link>
					</div>
				</aside>
			</div>
		</div>
	);
}

function QuantityStepper({
	variantId,
	quantity,
	max,
}: {
	variantId: number;
	quantity: number;
	max: number;
}) {
	return (
		<div className="mt-2 inline-flex items-center rounded-full border border-ink-200">
			<Form method="post">
				<input type="hidden" name="intent" value="update" />
				<input type="hidden" name="variantId" value={variantId} />
				<input type="hidden" name="quantity" value={quantity - 1} />
				<button
					type="submit"
					disabled={quantity <= 1}
					className="grid h-8 w-8 place-items-center rounded-l-full text-ink-600 disabled:opacity-40"
					aria-label="Giảm số lượng"
				>
					<MinusIcon className="h-3.5 w-3.5" />
				</button>
			</Form>
			<span className="w-8 text-center text-sm font-semibold">{quantity}</span>
			<Form method="post">
				<input type="hidden" name="intent" value="update" />
				<input type="hidden" name="variantId" value={variantId} />
				<input type="hidden" name="quantity" value={quantity + 1} />
				<button
					type="submit"
					disabled={quantity >= max}
					className="grid h-8 w-8 place-items-center rounded-r-full text-ink-600 disabled:opacity-40"
					aria-label="Tăng số lượng"
				>
					<PlusIcon className="h-3.5 w-3.5" />
				</button>
			</Form>
		</div>
	);
}

function Row({
	label,
	value,
	accent,
}: {
	label: string;
	value: string;
	accent?: string;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<dt className="text-ink-500">{label}</dt>
			<dd className={accent ?? "font-medium text-ink-800"}>{value}</dd>
		</div>
	);
}
