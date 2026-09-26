import { useMemo, useState } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/product-detail";
import { ProductGrid } from "~/components/shop/product-card";
import {
	CheckIcon,
	ChevronRightIcon,
	MinusIcon,
	PlusIcon,
	RefreshIcon,
	ShieldIcon,
	StarIcon,
	TruckIcon,
} from "~/components/icons";
import { getProductBySlug, getProductReviews, getRelatedProducts } from "~/lib/db.server";
import { releaseExpiredOrders } from "~/lib/order.server";
import { getSettings } from "~/lib/settings.server";
import { cn, formatDate, formatVnd } from "~/lib/format";
import { imageUrl, placeholderFor } from "~/lib/images";
import { TARGET_GROUPS } from "~/lib/types";

export function meta({ data }: Route.MetaArgs) {
	if (!data) return [{ title: "Sản phẩm — Lumi" }];

	const { product, shopUrl, shopName, ogImage } = data;
	const description =
		product.description?.slice(0, 200) ??
		`Mua ${product.name} tại ${shopName}. Giao hàng toàn quốc.`;
	const url = `${shopUrl}/san-pham/${product.slug}`;

	return [
		{ title: `${product.name} — ${shopName}` },
		{ name: "description", content: description },

		// Thẻ preview khi dán link lên Threads, Zalo, Facebook. Thiếu og:image
		// thì link hiện ra một khối trắng trơn — với shop bán qua Threads thì
		// mỗi bài đăng đều mất phần nhìn.
		{ property: "og:site_name", content: shopName },
		{ property: "og:title", content: product.name },
		{ property: "og:description", content: description },
		{ property: "og:type", content: "product" },
		{ property: "og:url", content: url },
		...(ogImage
			? [
					{ property: "og:image", content: ogImage },
					{ property: "og:image:alt", content: product.name },
					{ name: "twitter:card", content: "summary_large_image" },
					{ name: "twitter:image", content: ogImage },
				]
			: [{ name: "twitter:card", content: "summary" }]),
		{ name: "twitter:title", content: product.name },
		{ name: "twitter:description", content: description },
		{ property: "product:price:amount", content: String(product.sale_price) },
		{ property: "product:price:currency", content: "VND" },
	];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;

	// Trả kho cho các đơn quá hạn giữ chỗ trước khi đọc tồn — tránh hiện
	// "hết hàng" vì một đơn chuyển khoản bị bỏ dở 30 phút trước.
	await releaseExpiredOrders(db);

	const product = await getProductBySlug(db, params.slug);
	if (!product) throw new Response("Không tìm thấy sản phẩm", { status: 404 });

	const [related, reviews, settings] = await Promise.all([
		getRelatedProducts(db, product.id, product.category_id),
		product.review_count > 0 ? getProductReviews(db, product.id) : Promise.resolve([]),
		getSettings(db),
	]);

	const origin = new URL(request.url).origin;

	// CHỈ đặt og:image khi có ảnh thật. Ảnh mặc định của hệ thống là SVG, mà
	// Threads/Facebook không dựng preview từ SVG — đặt vào chỉ làm hỏng thẻ.
	const firstImage = product.images[0]?.r2_key;

	return {
		product,
		related,
		reviews,
		shopUrl: origin,
		shopName: settings.shop_name,
		ogImage: firstImage ? `${origin}/anh/${firstImage}` : null,
		freeShippingThreshold: Number.parseInt(settings.free_shipping_threshold, 10) || 0,
		returnDays: settings.return_policy_days,
	};
}

export default function ProductDetail({ loaderData }: Route.ComponentProps) {
	const { product, related, reviews, freeShippingThreshold, returnDays } = loaderData;

	// Danh sách màu / size rút ra từ biến thể, giữ nguyên thứ tự admin đã sắp
	const colors = useMemo(() => {
		const map = new Map<string, string | null>();
		for (const variant of product.variants) {
			if (variant.color && !map.has(variant.color)) {
				map.set(variant.color, variant.color_hex);
			}
		}
		return [...map.entries()].map(([name, hex]) => ({ name, hex }));
	}, [product.variants]);

	const sizes = useMemo(
		() => [...new Set(product.variants.map((variant) => variant.size))],
		[product.variants],
	);

	const [selectedColor, setSelectedColor] = useState<string | null>(colors[0]?.name ?? null);
	const [selectedSize, setSelectedSize] = useState<string | null>(null);
	const [quantity, setQuantity] = useState(1);
	const [activeImage, setActiveImage] = useState(0);

	const selectedVariant = product.variants.find(
		(variant) =>
			variant.size === selectedSize && (variant.color ?? null) === (selectedColor ?? null),
	);

	/** Size nào còn hàng ở màu đang chọn */
	const sizeAvailability = new Map(
		sizes.map((size) => {
			const variant = product.variants.find(
				(v) => v.size === size && (v.color ?? null) === (selectedColor ?? null),
			);
			return [size, variant?.quantity ?? 0];
		}),
	);

	// Ảnh gắn với màu đang chọn; nếu màu đó chưa có ảnh riêng thì dùng toàn bộ
	const images = useMemo(() => {
		const forColor = product.images.filter((image) => image.color === selectedColor);
		return forColor.length > 0 ? forColor : product.images;
	}, [product.images, selectedColor]);

	const mainImage = images[Math.min(activeImage, images.length - 1)];
	const discountPercent =
		product.compare_price && product.compare_price > product.sale_price
			? Math.round((1 - product.sale_price / product.compare_price) * 100)
			: 0;

	const maxQuantity = selectedVariant?.quantity ?? 0;
	const canBuy = Boolean(selectedVariant && maxQuantity > 0);

	return (
		<div className="mx-auto max-w-7xl px-4 py-4 md:py-8">
			<nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
				<Link to="/" className="hover:text-brand-600">
					Trang chủ
				</Link>
				{product.target_group && (
					<>
						<span>/</span>
						<Link
							to={`/${TARGET_GROUPS[product.target_group].slug}`}
							className="hover:text-brand-600"
						>
							{TARGET_GROUPS[product.target_group].label}
						</Link>
					</>
				)}
				{product.category_slug && (
					<>
						<span>/</span>
						<Link to={`/danh-muc/${product.category_slug}`} className="hover:text-brand-600">
							{product.category_name}
						</Link>
					</>
				)}
			</nav>

			<div className="md:grid md:grid-cols-2 md:gap-10">
				{/* --- Ảnh --------------------------------------------------- */}
				<div className="md:flex md:gap-3">
					<div className="order-2 min-w-0 flex-1">
						<div className="relative aspect-4/5 overflow-hidden rounded-2xl bg-ink-100">
							<img
								src={
									imageUrl(mainImage?.r2_key) ??
									placeholderFor(product.category_slug, product.target_group)
								}
								alt={mainImage?.alt ?? product.name}
								className="h-full w-full object-cover"
							/>
							{discountPercent > 0 && (
								<span className="badge absolute left-3 top-3 bg-brand-500 text-white">
									-{discountPercent}%
								</span>
							)}
						</div>
					</div>

					{images.length > 1 && (
						<div className="no-scrollbar order-1 mt-3 flex gap-2 overflow-x-auto md:mt-0 md:w-20 md:flex-col md:overflow-y-auto">
							{images.map((image, index) => (
								<button
									key={image.id}
									type="button"
									onClick={() => setActiveImage(index)}
									className={cn(
										"aspect-4/5 w-16 shrink-0 overflow-hidden rounded-lg border-2 md:w-full",
										index === activeImage ? "border-brand-500" : "border-transparent",
									)}
									aria-label={`Xem ảnh ${index + 1}`}
								>
									<img
										src={
											imageUrl(image.r2_key) ??
											placeholderFor(product.category_slug, product.target_group)
										}
										alt=""
										loading="lazy"
										className="h-full w-full object-cover"
									/>
								</button>
							))}
						</div>
					)}
				</div>

				{/* --- Thông tin & chọn mua ---------------------------------- */}
				<div className="mt-5 md:mt-0">
					<h1 className="text-xl font-bold leading-snug text-ink-900 md:text-2xl">
						{product.name}
					</h1>

					{product.review_count > 0 && (
						<div className="mt-1.5 flex items-center gap-1.5 text-sm">
							<Stars value={product.review_average ?? 0} />
							<span className="text-ink-500">
								{(product.review_average ?? 0).toFixed(1)} ({product.review_count} đánh giá)
							</span>
						</div>
					)}

					<div className="mt-3 flex flex-wrap items-baseline gap-2.5">
						<span className="text-2xl font-bold text-brand-600">
							{formatVnd(product.sale_price)}
						</span>
						{discountPercent > 0 && (
							<span className="text-base text-ink-400 line-through">
								{formatVnd(product.compare_price)}
							</span>
						)}
					</div>

					<Form method="post" action="/api/gio-hang" className="mt-5 space-y-5">
						<input type="hidden" name="intent" value="add" />
						<input type="hidden" name="variantId" value={selectedVariant?.id ?? ""} />
						<input type="hidden" name="quantity" value={quantity} />

						{colors.length > 0 && (
							<div>
								<p className="mb-2 text-sm font-medium text-ink-700">
									Màu sắc:{" "}
									<span className="font-normal text-ink-500">{selectedColor}</span>
								</p>
								<div className="flex flex-wrap gap-2.5">
									{colors.map((color) => (
										<button
											key={color.name}
											type="button"
											onClick={() => {
												setSelectedColor(color.name);
												setSelectedSize(null);
												setActiveImage(0);
											}}
											title={color.name}
											aria-pressed={selectedColor === color.name}
											className={cn(
												"grid h-9 w-9 place-items-center rounded-full border-2 ring-brand-500 ring-offset-2 transition",
												selectedColor === color.name
													? "border-white ring-2"
													: "border-ink-200",
											)}
											style={{ backgroundColor: color.hex ?? "#E9E0E5" }}
										>
											{selectedColor === color.name && (
												<CheckIcon className="h-4 w-4 text-white drop-shadow" />
											)}
											<span className="sr-only">{color.name}</span>
										</button>
									))}
								</div>
							</div>
						)}

						<div>
							<p className="mb-2 text-sm font-medium text-ink-700">Kích cỡ</p>
							<div className="flex flex-wrap gap-2">
								{sizes.map((size) => {
									const available = (sizeAvailability.get(size) ?? 0) > 0;
									return (
										<button
											key={size}
											type="button"
											disabled={!available}
											onClick={() => {
												setSelectedSize(size);
												setQuantity(1);
											}}
											aria-pressed={selectedSize === size}
											className={cn(
												"h-10 min-w-12 rounded-lg border px-3 text-sm font-medium transition",
												selectedSize === size
													? "border-brand-500 bg-brand-500 text-white"
													: "border-ink-200 text-ink-700 hover:border-brand-300",
												!available &&
													"cursor-not-allowed border-dashed text-ink-300 line-through hover:border-ink-200",
											)}
										>
											{size}
										</button>
									);
								})}
							</div>
							{selectedVariant && maxQuantity > 0 && maxQuantity <= 5 && (
								<p className="mt-2 text-xs font-medium text-brand-600">
									Chỉ còn {maxQuantity} sản phẩm
								</p>
							)}
						</div>

						<div>
							<p className="mb-2 text-sm font-medium text-ink-700">Số lượng</p>
							<div className="inline-flex items-center rounded-full border border-ink-200">
								<button
									type="button"
									onClick={() => setQuantity((value) => Math.max(1, value - 1))}
									disabled={quantity <= 1}
									className="grid h-10 w-10 place-items-center rounded-l-full text-ink-600 disabled:opacity-40"
									aria-label="Giảm số lượng"
								>
									<MinusIcon className="h-4 w-4" />
								</button>
								<span className="w-10 text-center text-sm font-semibold">{quantity}</span>
								<button
									type="button"
									onClick={() =>
										setQuantity((value) => Math.min(maxQuantity || 99, value + 1))
									}
									disabled={!canBuy || quantity >= maxQuantity}
									className="grid h-10 w-10 place-items-center rounded-r-full text-ink-600 disabled:opacity-40"
									aria-label="Tăng số lượng"
								>
									<PlusIcon className="h-4 w-4" />
								</button>
							</div>
						</div>

						{/* Nút mua: trên mobile ghim đáy màn hình cho dễ chạm */}
						<div className="flex gap-3 max-md:fixed max-md:inset-x-0 max-md:bottom-16 max-md:z-30 max-md:border-t max-md:border-ink-100 max-md:bg-white max-md:p-3">
							<button
								type="submit"
								name="redirectTo"
								value="/gio-hang"
								disabled={!canBuy}
								className="btn-outline btn-lg flex-1"
							>
								{selectedSize ? "Thêm vào giỏ" : "Chọn size"}
							</button>
							<button
								type="submit"
								name="redirectTo"
								value="/thanh-toan"
								disabled={!canBuy}
								className="btn-primary btn-lg flex-1"
							>
								Mua ngay
							</button>
						</div>
					</Form>

					<ul className="mt-6 space-y-2 rounded-xl bg-brand-50/60 p-4 text-sm text-ink-600 max-md:mb-24">
						<li className="flex items-center gap-2">
							<TruckIcon className="h-4.5 w-4.5 shrink-0 text-brand-500" />
							{freeShippingThreshold > 0
								? `Miễn phí giao hàng cho đơn từ ${formatVnd(freeShippingThreshold)}`
								: "Giao hàng toàn quốc"}
						</li>
						<li className="flex items-center gap-2">
							<RefreshIcon className="h-4.5 w-4.5 shrink-0 text-brand-500" />
							Đổi trả trong {returnDays} ngày với sản phẩm lỗi
						</li>
						<li className="flex items-center gap-2">
							<ShieldIcon className="h-4.5 w-4.5 shrink-0 text-brand-500" />
							Thanh toán COD, chuyển khoản hoặc MoMo
						</li>
					</ul>
				</div>
			</div>

			{/* --- Mô tả / chi tiết / đánh giá ------------------------------- */}
			<div className="mt-10 divide-y divide-ink-100 border-y border-ink-100">
				{product.description && (
					<Accordion title="Mô tả sản phẩm" defaultOpen>
						<p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
							{product.description}
						</p>
					</Accordion>
				)}
				{product.detail && (
					<Accordion title="Thông tin chi tiết">
						<p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
							{product.detail}
						</p>
					</Accordion>
				)}
				{reviews.length > 0 && (
					<Accordion title={`Đánh giá (${product.review_count})`}>
						<ul className="space-y-4">
							{reviews.map((review) => (
								<li key={review.id} className="border-b border-ink-100 pb-4 last:border-0">
									<div className="flex items-center gap-2">
										<span className="text-sm font-semibold text-ink-800">
											{review.author_name}
										</span>
										<Stars value={review.rating} />
										<span className="text-xs text-ink-400">
											{formatDate(review.created_at)}
										</span>
									</div>
									{review.content && (
										<p className="mt-1.5 text-sm text-ink-600">{review.content}</p>
									)}
								</li>
							))}
						</ul>
					</Accordion>
				)}
			</div>

			{related.length > 0 && (
				<section className="mt-10">
					<div className="mb-4 flex items-end justify-between">
						<h2 className="text-lg font-bold text-ink-900 md:text-xl">Có thể bạn thích</h2>
						{product.category_slug && (
							<Link
								to={`/danh-muc/${product.category_slug}`}
								className="flex items-center gap-0.5 text-sm font-medium text-brand-600"
							>
								Xem thêm
								<ChevronRightIcon className="h-4 w-4" />
							</Link>
						)}
					</div>
					<ProductGrid products={related} />
				</section>
			)}
		</div>
	);
}

function Stars({ value }: { value: number }) {
	return (
		<span className="flex items-center gap-0.5 text-amber-400" aria-label={`${value} trên 5 sao`}>
			{[1, 2, 3, 4, 5].map((index) => (
				<StarIcon key={index} filled={index <= Math.round(value)} className="h-3.5 w-3.5" />
			))}
		</span>
	);
}

function Accordion({
	title,
	children,
	defaultOpen = false,
}: {
	title: string;
	children: React.ReactNode;
	defaultOpen?: boolean;
}) {
	// <details> cho phép mở/đóng không cần JavaScript
	return (
		<details open={defaultOpen} className="group">
			<summary className="flex cursor-pointer list-none items-center justify-between py-4 text-sm font-semibold text-ink-800 marker:hidden">
				{title}
				<ChevronRightIcon className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-90" />
			</summary>
			<div className="pb-5">{children}</div>
		</details>
	);
}
