import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { CheckIcon, StarIcon } from "~/components/icons";
import { cn } from "~/lib/format";
import { imageUrl, placeholderFor } from "~/lib/images";
import type { ReviewableItem } from "~/lib/reviews.server";

/**
 * Khối đánh giá trong trang theo dõi đơn, hiện sau khi đơn đã giao.
 *
 * Đặt ở đây chứ không phải trang sản phẩm vì trang này đã xác minh người xem là
 * khách thật của đơn thật — không cần captcha hay bước duyệt nào khác.
 */
export function ReviewSection({
	items,
	customerName,
}: {
	items: ReviewableItem[];
	customerName: string;
}) {
	if (items.length === 0) return null;

	const reviewed = items.filter((item) => item.review).length;

	return (
		<section className="card mt-5 p-4 md:p-5">
			<div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-ink-900">Đánh giá sản phẩm</h2>
				{reviewed > 0 && (
					<span className="text-xs text-ink-400">
						đã đánh giá {reviewed}/{items.length}
					</span>
				)}
			</div>
			<p className="mb-4 text-sm text-ink-500">
				Nhận xét của bạn hiện trên trang sản phẩm, giúp người mua sau chọn đúng size
				và chất liệu.
			</p>

			<ul className="space-y-4">
				{items.map((item) => (
					<li key={item.productId}>
						<ReviewRow item={item} customerName={customerName} />
					</li>
				))}
			</ul>
		</section>
	);
}

function ReviewRow({
	item,
	customerName,
}: {
	item: ReviewableItem;
	customerName: string;
}) {
	const navigation = useNavigation();
	const submitting =
		navigation.state === "submitting" &&
		navigation.formData?.get("productId") === String(item.productId);

	// Đã gửi rồi thì mở sẵn số sao cũ để khách sửa lại được
	const [rating, setRating] = useState(item.review?.rating ?? 0);
	const [open, setOpen] = useState(!item.review);

	return (
		<div className="rounded-xl border border-ink-200 p-3.5">
			<div className="flex items-start gap-3">
				<div className="aspect-4/5 w-12 shrink-0 overflow-hidden rounded-md bg-ink-100">
					<img
						src={imageUrl(item.imageKey) ?? placeholderFor(null)}
						alt=""
						className="h-full w-full object-cover"
					/>
				</div>

				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-ink-800">{item.productName}</p>

					{item.review && !open ? (
						<div className="mt-1 flex flex-wrap items-center gap-2">
							<Stars value={item.review.rating} />
							<span className="flex items-center gap-1 text-xs text-green-700">
								<CheckIcon className="h-3.5 w-3.5" />
								Đã gửi đánh giá
							</span>
							<button
								type="button"
								onClick={() => setOpen(true)}
								className="text-xs font-medium text-brand-600 hover:underline"
							>
								Sửa
							</button>
						</div>
					) : null}
				</div>
			</div>

			{open && (
				<Form method="post" className="mt-3 space-y-3">
					<input type="hidden" name="intent" value="review" />
					<input type="hidden" name="productId" value={item.productId} />
					<input type="hidden" name="rating" value={rating} />

					<div>
						<span className="field-label">Bạn thấy sản phẩm thế nào?</span>
						<div className="flex items-center gap-1">
							{[1, 2, 3, 4, 5].map((star) => (
								<button
									key={star}
									type="button"
									onClick={() => setRating(star)}
									aria-label={`${star} sao`}
									aria-pressed={rating === star}
									className="p-0.5 text-amber-400 transition-transform hover:scale-110"
								>
									<StarIcon
										filled={star <= rating}
										className={cn("h-7 w-7", star > rating && "text-ink-300")}
									/>
								</button>
							))}
						</div>
					</div>

					<div>
						<label htmlFor={`content-${item.productId}`} className="field-label">
							Nhận xét <span className="text-ink-400">(không bắt buộc)</span>
						</label>
						<textarea
							id={`content-${item.productId}`}
							name="content"
							rows={3}
							defaultValue={item.review?.content ?? ""}
							maxLength={600}
							placeholder="Vải mặc có mát không, form có đúng size không..."
							className="field text-sm"
						/>
					</div>

					<input type="hidden" name="authorName" value={customerName} />

					<div className="flex gap-2">
						<button
							type="submit"
							disabled={submitting || rating === 0}
							className="btn-primary btn-sm"
						>
							{submitting ? "Đang gửi..." : item.review ? "Cập nhật" : "Gửi đánh giá"}
						</button>
						{item.review && (
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="btn-ghost btn-sm"
							>
								Huỷ
							</button>
						)}
					</div>
				</Form>
			)}
		</div>
	);
}

function Stars({ value }: { value: number }) {
	return (
		<span className="flex items-center gap-0.5 text-amber-400" aria-label={`${value} trên 5 sao`}>
			{[1, 2, 3, 4, 5].map((star) => (
				<StarIcon
					key={star}
					filled={star <= value}
					className={cn("h-4 w-4", star > value && "text-ink-300")}
				/>
			))}
		</span>
	);
}
