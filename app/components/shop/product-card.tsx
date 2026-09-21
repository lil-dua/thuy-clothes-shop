import { Link } from "react-router";
import { formatVnd, cn } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import type { ProductListItem } from "~/lib/types";

/**
 * Thẻ sản phẩm dùng chung cho trang chủ và trang danh sách.
 * Ảnh khung 4:5 cố định để lưới không bị "nhảy" khi ảnh tải xong (tránh CLS).
 */
export function ProductCard({ product }: { product: ProductListItem }) {
	const src = imageUrl(product.image_key) ?? IMAGE_PLACEHOLDER;
	const soldOut = product.total_stock <= 0;
	const discountPercent =
		product.compare_price && product.compare_price > product.sale_price
			? Math.round((1 - product.sale_price / product.compare_price) * 100)
			: 0;

	return (
		<Link
			to={`/san-pham/${product.slug}`}
			className="group block"
			aria-label={product.name}
		>
			<div className="relative aspect-4/5 overflow-hidden rounded-xl bg-ink-100">
				<img
					src={src}
					alt={product.name}
					loading="lazy"
					className={cn(
						"h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
						soldOut && "opacity-60",
					)}
				/>

				{discountPercent > 0 && !soldOut && (
					<span className="badge absolute left-2 top-2 bg-brand-500 text-white">
						-{discountPercent}%
					</span>
				)}

				{soldOut && (
					<span className="absolute inset-x-0 bottom-0 bg-ink-800/75 py-1.5 text-center text-xs font-semibold text-white">
						Tạm hết hàng
					</span>
				)}
			</div>

			<h3 className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug text-ink-800 group-hover:text-brand-600">
				{product.name}
			</h3>

			<div className="mt-1 flex flex-wrap items-baseline gap-x-2">
				<span className="font-semibold text-brand-600">{formatVnd(product.sale_price)}</span>
				{discountPercent > 0 && (
					<span className="text-xs text-ink-400 line-through">
						{formatVnd(product.compare_price)}
					</span>
				)}
			</div>
		</Link>
	);
}

export function ProductGrid({
	products,
	emptyMessage = "Chưa có sản phẩm nào.",
}: {
	products: ProductListItem[];
	emptyMessage?: string;
}) {
	if (products.length === 0) {
		return (
			<p className="rounded-xl bg-ink-50 px-4 py-10 text-center text-sm text-ink-500">
				{emptyMessage}
			</p>
		);
	}

	return (
		// 2 cột trên điện thoại là mật độ quen thuộc của người mua sắm VN
		<div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
			{products.map((product) => (
				<ProductCard key={product.id} product={product} />
			))}
		</div>
	);
}
