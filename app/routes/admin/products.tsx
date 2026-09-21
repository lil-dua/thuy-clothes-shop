import { Form, Link, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/products";
import {
	EmptyState,
	PageHeader,
	Pagination,
	TableWrap,
} from "~/components/admin/ui";
import { EditIcon, PlusIcon, SearchIcon, TrashIcon } from "~/components/icons";
import { getCategories, listAdminProducts } from "~/lib/db.server";
import { cn, formatVnd } from "~/lib/format";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import { TARGET_GROUPS, type ProductStatus, type TargetGroup } from "~/lib/types";

export function meta() {
	return [{ title: "Sản phẩm — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

const STATUS_LABEL: Record<ProductStatus, string> = {
	active: "Đang bán",
	hidden: "Đã ẩn",
	discontinued: "Ngừng bán",
};

const STATUS_STYLE: Record<ProductStatus, string> = {
	active: "bg-green-100 text-green-700",
	hidden: "bg-ink-100 text-ink-600",
	discontinued: "bg-red-100 text-red-700",
};

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const url = new URL(request.url);

	const [result, categories] = await Promise.all([
		listAdminProducts(db, {
			search: url.searchParams.get("q")?.trim() || null,
			categoryId: Number.parseInt(url.searchParams.get("danh-muc") ?? "", 10) || null,
			status: url.searchParams.get("trang-thai") || null,
			page: Number.parseInt(url.searchParams.get("trang") ?? "1", 10) || 1,
			perPage: 20,
		}),
		getCategories(db),
	]);

	return { ...result, categories };
}

export async function action({ request, context }: Route.ActionArgs) {
	const db = context.cloudflare.env.DB;
	const form = await request.formData();
	const id = Number.parseInt(String(form.get("productId") ?? ""), 10);
	if (!Number.isInteger(id)) return redirect("/admin/san-pham");

	// Ngừng bán thay vì xoá cứng: đơn hàng cũ vẫn phải tra được sản phẩm.
	if (String(form.get("intent")) === "discontinue") {
		await db
			.prepare(
				`UPDATE products SET status = 'discontinued', updated_at = datetime('now') WHERE id = ?1`,
			)
			.bind(id)
			.run();
	}
	return redirect("/admin/san-pham");
}

export default function AdminProducts({ loaderData }: Route.ComponentProps) {
	const { items, total, page, perPage, categories } = loaderData;
	const [searchParams] = useSearchParams();

	const buildLink = (targetPage: number) => {
		const next = new URLSearchParams(searchParams);
		next.set("trang", String(targetPage));
		return `?${next.toString()}`;
	};

	return (
		<>
			<PageHeader
				title="Sản phẩm"
				description={`${total} sản phẩm trong hệ thống`}
				action={
					<Link to="/admin/san-pham/moi" className="btn-primary btn-md">
						<PlusIcon className="h-4 w-4" />
						Thêm sản phẩm
					</Link>
				}
			/>

			<Form method="get" className="mb-4 flex flex-wrap gap-2.5">
				<div className="relative min-w-52 flex-1">
					<SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
					<input
						type="search"
						name="q"
						defaultValue={searchParams.get("q") ?? ""}
						placeholder="Tìm kiếm sản phẩm..."
						className="field !py-2 pl-9 text-sm"
					/>
				</div>

				<select
					name="danh-muc"
					defaultValue={searchParams.get("danh-muc") ?? ""}
					className="field !w-auto !py-2 text-sm"
				>
					<option value="">Tất cả danh mục</option>
					{(Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => (
						<optgroup key={group} label={TARGET_GROUPS[group].label}>
							{categories
								.filter((category) => category.target_group === group)
								.map((category) => (
									<option key={category.id} value={category.id}>
										{category.name}
									</option>
								))}
						</optgroup>
					))}
				</select>

				<select
					name="trang-thai"
					defaultValue={searchParams.get("trang-thai") ?? ""}
					className="field !w-auto !py-2 text-sm"
				>
					<option value="">Tất cả trạng thái</option>
					{(Object.keys(STATUS_LABEL) as ProductStatus[]).map((status) => (
						<option key={status} value={status}>
							{STATUS_LABEL[status]}
						</option>
					))}
				</select>

				<button type="submit" className="btn-outline btn-md">
					Lọc
				</button>
			</Form>

			<TableWrap>
				{items.length === 0 ? (
					<EmptyState
						title="Chưa có sản phẩm nào"
						description="Thêm sản phẩm đầu tiên để bắt đầu bán hàng."
						action={
							<Link to="/admin/san-pham/moi" className="btn-primary btn-md">
								Thêm sản phẩm
							</Link>
						}
					/>
				) : (
					<table className="w-full min-w-[52rem] text-sm">
						<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
							<tr>
								<th className="px-4 py-2.5 font-semibold">Ảnh</th>
								<th className="px-4 py-2.5 font-semibold">Tên sản phẩm</th>
								<th className="px-4 py-2.5 text-right font-semibold">Giá nhập</th>
								<th className="px-4 py-2.5 text-right font-semibold">Giá bán</th>
								<th className="px-4 py-2.5 text-right font-semibold">Tồn kho</th>
								<th className="px-4 py-2.5 font-semibold">Trạng thái</th>
								<th className="px-4 py-2.5 text-right font-semibold">Thao tác</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-ink-100">
							{items.map((product) => (
								<tr key={product.id} className="hover:bg-ink-50/60">
									<td className="px-4 py-2">
										<div className="aspect-4/5 w-10 overflow-hidden rounded-md bg-ink-100">
											<img
												src={imageUrl(product.image_key) ?? IMAGE_PLACEHOLDER}
												alt=""
												className="h-full w-full object-cover"
											/>
										</div>
									</td>
									<td className="px-4 py-2">
										<Link
											to={`/admin/san-pham/${product.id}`}
											className="font-medium text-ink-800 hover:text-brand-600"
										>
											{product.name}
										</Link>
										<span className="block text-xs text-ink-400">
											{product.category_name ?? "Chưa phân loại"}
											{product.target_group &&
												` · ${TARGET_GROUPS[product.target_group].label}`}
										</span>
									</td>
									<td className="px-4 py-2 text-right text-ink-500">
										{formatVnd(product.cost_price)}
									</td>
									<td className="px-4 py-2 text-right font-medium text-ink-800">
										{formatVnd(product.sale_price)}
									</td>
									<td
										className={cn(
											"px-4 py-2 text-right font-medium",
											product.total_stock === 0
												? "text-red-600"
												: product.total_stock <= 5
													? "text-amber-600"
													: "text-ink-800",
										)}
									>
										{product.total_stock}
									</td>
									<td className="px-4 py-2">
										<span className={cn("badge", STATUS_STYLE[product.status])}>
											{STATUS_LABEL[product.status]}
										</span>
									</td>
									<td className="px-4 py-2">
										<div className="flex justify-end gap-1">
											<Link
												to={`/admin/san-pham/${product.id}`}
												className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-brand-50 hover:text-brand-600"
												aria-label={`Sửa ${product.name}`}
											>
												<EditIcon className="h-4 w-4" />
											</Link>
											{product.status !== "discontinued" && (
												<Form
													method="post"
													onSubmit={(event) => {
														if (
															!confirm(
																`Ngừng bán "${product.name}"? Sản phẩm sẽ bị ẩn khỏi website nhưng đơn hàng cũ vẫn giữ nguyên.`,
															)
														) {
															event.preventDefault();
														}
													}}
												>
													<input type="hidden" name="intent" value="discontinue" />
													<input type="hidden" name="productId" value={product.id} />
													<button
														type="submit"
														className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
														aria-label={`Ngừng bán ${product.name}`}
													>
														<TrashIcon className="h-4 w-4" />
													</button>
												</Form>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}

				<Pagination
					page={page}
					pageCount={Math.ceil(total / perPage)}
					buildLink={buildLink}
				/>
			</TableWrap>
		</>
	);
}
