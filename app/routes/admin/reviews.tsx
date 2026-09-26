import { Form, Link, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/reviews";
import { EmptyState, PageHeader, Pagination, TableWrap } from "~/components/admin/ui";
import { StarIcon, TrashIcon } from "~/components/icons";
import { cn, formatDateTime } from "~/lib/format";
import { deleteReview, listReviews, setReviewVisible } from "~/lib/reviews.server";

export function meta() {
	return [{ title: "Đánh giá — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const visible = url.searchParams.get("hien-thi");

	const result = await listReviews(context.cloudflare.env.DB, {
		visible,
		page: Number.parseInt(url.searchParams.get("trang") ?? "1", 10) || 1,
		perPage: 30,
	});

	return { ...result, visible };
}

export async function action({ request, context }: Route.ActionArgs) {
	const db = context.cloudflare.env.DB;
	const form = await request.formData();
	const id = Number.parseInt(String(form.get("reviewId") ?? ""), 10);
	if (!Number.isInteger(id)) return redirect("/admin/danh-gia");

	const intent = String(form.get("intent") ?? "");
	if (intent === "toggle") {
		await setReviewVisible(db, id, form.get("visible") === "1");
	} else if (intent === "delete") {
		await deleteReview(db, id);
	}

	return redirect(`/admin/danh-gia${new URL(request.url).search}`);
}

export default function AdminReviews({ loaderData }: Route.ComponentProps) {
	const { items, total, page, perPage, visible } = loaderData;
	const [searchParams] = useSearchParams();

	const tab = (value: string | null, label: string) => {
		const next = new URLSearchParams(searchParams);
		next.delete("trang");
		if (value) next.set("hien-thi", value);
		else next.delete("hien-thi");
		const query = next.toString();
		return (
			<Link
				to={query ? `?${query}` : "."}
				className={cn("chip", visible === value && "chip-active")}
			>
				{label}
			</Link>
		);
	};

	return (
		<>
			<PageHeader
				title="Đánh giá"
				description="Nhận xét do khách đã nhận hàng gửi lên — ẩn đi nếu không phù hợp"
			/>

			<div className="mb-4 flex flex-wrap gap-2">
				{tab(null, "Tất cả")}
				{tab("shown", "Đang hiện")}
				{tab("hidden", "Đã ẩn")}
			</div>

			<TableWrap>
				{items.length === 0 ? (
					<EmptyState
						title="Chưa có đánh giá nào"
						description="Khách đánh giá được sau khi đơn chuyển sang trạng thái Đã giao."
					/>
				) : (
					<table className="w-full min-w-[52rem] text-sm">
						<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
							<tr>
								<th className="px-4 py-2.5 font-semibold">Sản phẩm</th>
								<th className="px-4 py-2.5 font-semibold">Đánh giá</th>
								<th className="px-4 py-2.5 font-semibold">Khách</th>
								<th className="px-4 py-2.5 font-semibold">Thời gian</th>
								<th className="px-4 py-2.5 text-right font-semibold">Thao tác</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-ink-100">
							{items.map((review) => (
								<tr
									key={review.id}
									className={cn("hover:bg-ink-50/60", !review.is_visible && "opacity-55")}
								>
									<td className="max-w-[14rem] px-4 py-2.5">
										{review.product_slug ? (
											<Link
												to={`/san-pham/${review.product_slug}`}
												target="_blank"
												rel="noreferrer"
												className="font-medium text-ink-800 hover:text-brand-600"
											>
												{review.product_name}
											</Link>
										) : (
											<span className="text-ink-500">Sản phẩm đã xoá</span>
										)}
										{review.order_code && (
											<span className="block text-xs text-ink-400">
												đơn #{review.order_code}
											</span>
										)}
									</td>

									<td className="max-w-sm px-4 py-2.5">
										<span className="flex items-center gap-0.5 text-amber-400">
											{[1, 2, 3, 4, 5].map((star) => (
												<StarIcon
													key={star}
													filled={star <= review.rating}
													className={cn("h-3.5 w-3.5", star > review.rating && "text-ink-300")}
												/>
											))}
										</span>
										{review.content && (
											<p className="mt-1 whitespace-pre-line text-xs text-ink-600">
												{review.content}
											</p>
										)}
									</td>

									<td className="px-4 py-2.5 text-ink-700">{review.author_name}</td>

									<td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">
										{formatDateTime(review.created_at)}
									</td>

									<td className="px-4 py-2.5">
										<div className="flex items-center justify-end gap-1.5">
											<Form method="post">
												<input type="hidden" name="intent" value="toggle" />
												<input type="hidden" name="reviewId" value={review.id} />
												<input
													type="hidden"
													name="visible"
													value={review.is_visible ? "0" : "1"}
												/>
												<button
													type="submit"
													className={cn(
														"badge",
														review.is_visible
															? "bg-green-100 text-green-700 hover:bg-green-200"
															: "bg-ink-100 text-ink-500 hover:bg-ink-200",
													)}
												>
													{review.is_visible ? "Đang hiện" : "Đã ẩn"}
												</button>
											</Form>

											<Form
												method="post"
												onSubmit={(event) => {
													if (!confirm("Xoá hẳn đánh giá này?")) event.preventDefault();
												}}
											>
												<input type="hidden" name="intent" value="delete" />
												<input type="hidden" name="reviewId" value={review.id} />
												<button
													type="submit"
													className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
													aria-label="Xoá đánh giá"
												>
													<TrashIcon className="h-4 w-4" />
												</button>
											</Form>
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
					buildLink={(target) => {
						const next = new URLSearchParams(searchParams);
						next.set("trang", String(target));
						return `?${next.toString()}`;
					}}
				/>
			</TableWrap>
		</>
	);
}
