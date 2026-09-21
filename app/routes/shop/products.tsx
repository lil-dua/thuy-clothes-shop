import { useState } from "react";
import { Form, Link, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/products";
import { ProductGrid } from "~/components/shop/product-card";
import { CloseIcon, FilterIcon } from "~/components/icons";
import {
	getCategoriesWithCount,
	getCategoryBySlug,
	getFilterFacets,
	listProducts,
} from "~/lib/db.server";
import { cn } from "~/lib/format";
import {
	SORT_LABEL,
	TARGET_GROUPS,
	type ProductSort,
	type TargetGroup,
} from "~/lib/types";

/** Tên tham số URL để người dùng đọc được đường dẫn khi chia sẻ */
const PARAM = {
	search: "q",
	category: "danh-muc",
	size: "size",
	color: "mau",
	price: "gia",
	sort: "sap-xep",
	page: "trang",
} as const;

const SORT_PARAM_TO_SQL: Record<string, ProductSort> = {
	"moi-nhat": "newest",
	"gia-tang": "price_asc",
	"gia-giam": "price_desc",
	"ban-chay": "bestseller",
};
const SORT_SQL_TO_PARAM: Record<ProductSort, string> = {
	newest: "moi-nhat",
	price_asc: "gia-tang",
	price_desc: "gia-giam",
	bestseller: "ban-chay",
};

const PRICE_RANGES = [
	{ value: "duoi-200", label: "Dưới 200k", min: null, max: 200_000 },
	{ value: "200-300", label: "200k – 300k", min: 200_000, max: 300_000 },
	{ value: "300-500", label: "300k – 500k", min: 300_000, max: 500_000 },
	{ value: "tren-500", label: "Trên 500k", min: 500_000, max: null },
] as const;

export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: `${data?.heading ?? "Sản phẩm"} — Lumi` },
		{ name: "description", content: `Danh sách ${data?.heading ?? "sản phẩm"} tại Lumi.` },
	];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const url = new URL(request.url);

	// Nhóm đối tượng suy ra từ chính đường dẫn: /nu, /tre-em
	let targetGroup: TargetGroup | null = null;
	if (url.pathname === "/nu") targetGroup = "women";
	else if (url.pathname === "/tre-em") targetGroup = "kids";

	// Danh mục có thể đến từ path (/danh-muc/:slug) hoặc từ query (?danh-muc=)
	const categorySlug = params.categorySlug ?? url.searchParams.get(PARAM.category) ?? null;
	const category = categorySlug ? await getCategoryBySlug(db, categorySlug) : null;
	if (categorySlug && !category) {
		throw new Response("Không tìm thấy danh mục", { status: 404 });
	}
	if (category) targetGroup = category.target_group;

	const priceRange = PRICE_RANGES.find(
		(range) => range.value === url.searchParams.get(PARAM.price),
	);

	const sortParam = url.searchParams.get(PARAM.sort) ?? "";
	const sort = SORT_PARAM_TO_SQL[sortParam] ?? "newest";
	const search = url.searchParams.get(PARAM.search)?.trim() || null;
	const page = Math.max(1, Number.parseInt(url.searchParams.get(PARAM.page) ?? "1", 10) || 1);

	const [result, categories, facets] = await Promise.all([
		listProducts(db, {
			targetGroup,
			categorySlug: category?.slug ?? null,
			sizes: url.searchParams.getAll(PARAM.size),
			colors: url.searchParams.getAll(PARAM.color),
			priceMin: priceRange?.min ?? null,
			priceMax: priceRange?.max ?? null,
			search,
			sort,
			page,
			perPage: 12,
		}),
		getCategoriesWithCount(db),
		getFilterFacets(db, targetGroup),
	]);

	const heading = search
		? `Kết quả cho "${search}"`
		: (category?.name ?? (targetGroup ? TARGET_GROUPS[targetGroup].label : "Tất cả sản phẩm"));

	return {
		...result,
		heading,
		search,
		targetGroup,
		activeCategory: category,
		categories: categories.filter((c) => !targetGroup || c.target_group === targetGroup),
		facets,
		sort: SORT_SQL_TO_PARAM[sort],
	};
}

export default function Products({ loaderData }: Route.ComponentProps) {
	const { items, total, page, perPage, heading, categories, facets, activeCategory } =
		loaderData;
	const [filtersOpen, setFiltersOpen] = useState(false);
	const pageCount = Math.ceil(total / perPage);

	return (
		<div className="mx-auto max-w-7xl px-4 py-5 md:py-8">
			<Breadcrumb loaderData={loaderData} />

			<div className="mb-4 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-xl font-bold text-ink-900 md:text-2xl">{heading}</h1>
					<p className="text-sm text-ink-500">{total} sản phẩm</p>
				</div>
				<SortSelect currentSort={loaderData.sort} />
			</div>

			{/* Chip danh mục — cuộn ngang trên mobile, giống thanh danh mục quen thuộc */}
			{categories.length > 0 && (
				<div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
					<CategoryChip to={categoryLink(loaderData, null)} active={!activeCategory}>
						Tất cả
					</CategoryChip>
					{categories.map((category) => (
						<CategoryChip
							key={category.id}
							to={`/danh-muc/${category.slug}`}
							active={activeCategory?.id === category.id}
						>
							{category.name}
						</CategoryChip>
					))}
				</div>
			)}

			<div className="md:flex md:gap-8">
				{/* Bộ lọc: cột trái trên desktop, ngăn kéo trượt lên trên mobile */}
				<aside className="hidden w-56 shrink-0 md:block">
					<FilterPanel facets={facets} />
				</aside>

				<div className="min-w-0 flex-1">
					<ProductGrid
						products={items}
						emptyMessage="Không tìm thấy sản phẩm phù hợp. Thử bỏ bớt bộ lọc nhé."
					/>
					{pageCount > 1 && <Pagination page={page} pageCount={pageCount} />}
				</div>
			</div>

			{/* Nút mở bộ lọc trên mobile — nổi phía trên thanh tab dưới */}
			<button
				type="button"
				onClick={() => setFiltersOpen(true)}
				className="btn-primary btn-md fixed bottom-20 left-1/2 z-30 -translate-x-1/2 shadow-lg shadow-brand-500/30 md:hidden"
			>
				<FilterIcon className="h-4 w-4" />
				Bộ lọc
			</button>

			{filtersOpen && (
				<div className="fixed inset-0 z-50 md:hidden">
					<button
						type="button"
						aria-label="Đóng bộ lọc"
						className="absolute inset-0 bg-ink-900/40"
						onClick={() => setFiltersOpen(false)}
					/>
					<div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-8">
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-lg font-bold text-ink-900">Bộ lọc</h2>
							<button
								type="button"
								onClick={() => setFiltersOpen(false)}
								className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink-100"
								aria-label="Đóng"
							>
								<CloseIcon className="h-5 w-5" />
							</button>
						</div>
						<FilterPanel facets={facets} onApply={() => setFiltersOpen(false)} />
					</div>
				</div>
			)}
		</div>
	);
}

function Breadcrumb({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
	const { targetGroup, activeCategory } = loaderData;
	return (
		<nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
			<Link to="/" className="hover:text-brand-600">
				Trang chủ
			</Link>
			{targetGroup && (
				<>
					<span>/</span>
					<Link to={`/${TARGET_GROUPS[targetGroup].slug}`} className="hover:text-brand-600">
						{TARGET_GROUPS[targetGroup].label}
					</Link>
				</>
			)}
			{activeCategory && (
				<>
					<span>/</span>
					<span className="text-ink-600">{activeCategory.name}</span>
				</>
			)}
		</nav>
	);
}

function categoryLink(
	loaderData: Route.ComponentProps["loaderData"],
	_categorySlug: string | null,
): string {
	return loaderData.targetGroup ? `/${TARGET_GROUPS[loaderData.targetGroup].slug}` : "/san-pham";
}

function CategoryChip({
	to,
	active,
	children,
}: {
	to: string;
	active: boolean;
	children: React.ReactNode;
}) {
	return (
		<Link to={to} className={cn("chip", active && "chip-active")}>
			{children}
		</Link>
	);
}

function SortSelect({ currentSort }: { currentSort: string }) {
	const submit = useSubmit();
	const [searchParams] = useSearchParams();

	return (
		<Form
			method="get"
			onChange={(event) => submit(event.currentTarget, { replace: true })}
			className="flex items-center gap-2"
		>
			{/* Giữ lại các bộ lọc khác khi đổi cách sắp xếp */}
			{[...searchParams.entries()]
				.filter(([key]) => key !== PARAM.sort && key !== PARAM.page)
				.map(([key, value], index) => (
					<input key={`${key}-${index}`} type="hidden" name={key} value={value} />
				))}
			<label htmlFor="sort" className="shrink-0 text-sm text-ink-500">
				Sắp xếp
			</label>
			<select
				id="sort"
				name={PARAM.sort}
				defaultValue={currentSort}
				className="field !w-auto !py-1.5 text-sm"
			>
				{(Object.keys(SORT_SQL_TO_PARAM) as ProductSort[]).map((key) => (
					<option key={key} value={SORT_SQL_TO_PARAM[key]}>
						{SORT_LABEL[key]}
					</option>
				))}
			</select>
		</Form>
	);
}

function FilterPanel({
	facets,
	onApply,
}: {
	facets: { sizes: string[]; colors: { name: string; hex: string | null }[] };
	onApply?: () => void;
}) {
	const [searchParams] = useSearchParams();
	const selectedSizes = searchParams.getAll(PARAM.size);
	const selectedColors = searchParams.getAll(PARAM.color);
	const selectedPrice = searchParams.get(PARAM.price) ?? "";
	const hasFilters = selectedSizes.length + selectedColors.length > 0 || selectedPrice !== "";

	return (
		<Form method="get" onSubmit={onApply} className="space-y-6">
			{/* Giữ từ khoá tìm kiếm khi lọc tiếp */}
			{searchParams.get(PARAM.search) && (
				<input type="hidden" name={PARAM.search} value={searchParams.get(PARAM.search)!} />
			)}

			<FilterGroup title="Khoảng giá">
				<div className="space-y-2">
					{PRICE_RANGES.map((range) => (
						<label key={range.value} className="flex items-center gap-2.5 text-sm">
							<input
								type="radio"
								name={PARAM.price}
								value={range.value}
								defaultChecked={selectedPrice === range.value}
								className="h-4 w-4 accent-brand-500"
							/>
							<span className="text-ink-600">{range.label}</span>
						</label>
					))}
				</div>
			</FilterGroup>

			{facets.sizes.length > 0 && (
				<FilterGroup title="Size">
					<div className="flex flex-wrap gap-2">
						{facets.sizes.map((size) => (
							<label key={size} className="cursor-pointer">
								<input
									type="checkbox"
									name={PARAM.size}
									value={size}
									defaultChecked={selectedSizes.includes(size)}
									className="peer sr-only"
								/>
								<span className="chip peer-checked:border-brand-500 peer-checked:bg-brand-500 peer-checked:text-white">
									{size}
								</span>
							</label>
						))}
					</div>
				</FilterGroup>
			)}

			{facets.colors.length > 0 && (
				<FilterGroup title="Màu sắc">
					<div className="flex flex-wrap gap-2.5">
						{facets.colors.map((color) => (
							<label key={color.name} className="cursor-pointer" title={color.name}>
								<input
									type="checkbox"
									name={PARAM.color}
									value={color.name}
									defaultChecked={selectedColors.includes(color.name)}
									className="peer sr-only"
								/>
								<span
									className="block h-7 w-7 rounded-full border-2 border-ink-200 ring-brand-500 ring-offset-2 peer-checked:ring-2"
									style={{ backgroundColor: color.hex ?? "#E9E0E5" }}
								>
									<span className="sr-only">{color.name}</span>
								</span>
							</label>
						))}
					</div>
				</FilterGroup>
			)}

			<div className="flex gap-2">
				<button type="submit" className="btn-primary btn-md flex-1">
					Áp dụng
				</button>
				{hasFilters && (
					<Link to="." className="btn-ghost btn-md" onClick={onApply}>
						Xoá lọc
					</Link>
				)}
			</div>
		</Form>
	);
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<h3 className="mb-2.5 text-sm font-semibold text-ink-800">{title}</h3>
			{children}
		</div>
	);
}

function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
	const [searchParams] = useSearchParams();

	const linkTo = (target: number) => {
		const next = new URLSearchParams(searchParams);
		next.set(PARAM.page, String(target));
		return `?${next.toString()}`;
	};

	// Chỉ hiện tối đa 5 số quanh trang hiện tại, tránh tràn dòng trên mobile
	const start = Math.max(1, Math.min(page - 2, pageCount - 4));
	const numbers = Array.from({ length: Math.min(5, pageCount) }, (_, i) => start + i);

	return (
		<nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Phân trang">
			{page > 1 && (
				<Link to={linkTo(page - 1)} className="btn-ghost btn-sm">
					Trước
				</Link>
			)}
			{numbers.map((number) => (
				<Link
					key={number}
					to={linkTo(number)}
					aria-current={number === page ? "page" : undefined}
					className={cn(
						"grid h-9 w-9 place-items-center rounded-full text-sm font-medium",
						number === page
							? "bg-brand-500 text-white"
							: "text-ink-600 hover:bg-brand-50",
					)}
				>
					{number}
				</Link>
			))}
			{page < pageCount && (
				<Link to={linkTo(page + 1)} className="btn-ghost btn-sm">
					Sau
				</Link>
			)}
		</nav>
	);
}
