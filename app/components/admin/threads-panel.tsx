import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { AlertIcon, CheckIcon, SettingsIcon, TrashIcon } from "~/components/icons";
import { cn, formatDateTime, vnLocalAt, vnLocalInput } from "~/lib/format";
import { POST_STATUS_LABEL, POST_STATUS_STYLE, type SocialPost } from "~/lib/threads";

export interface ThreadsPanelData {
	/** Đã có API key và đã chọn tài khoản chưa — quyết định panel có dùng được không */
	ready: boolean;
	hasApiKey: boolean;
	socialSetName: string;
	/** Caption sinh sẵn từ mẫu, chủ shop sửa lại trước khi đăng */
	captionPreview: string;
	imageCount: number;
	posts: SocialPost[];
}

/** Khung giờ người Việt hay lướt mạng — đỡ phải bấm lịch từng lần */
const QUICK_SLOTS = [
	{ label: "Tối nay 20:00", value: () => vnLocalAt(0, 20) },
	{ label: "Sáng mai 10:00", value: () => vnLocalAt(1, 10) },
	{ label: "Tối mai 20:00", value: () => vnLocalAt(1, 20) },
];

/**
 * Khối đăng sản phẩm lên Threads, nằm ngoài biểu mẫu sản phẩm.
 * Tách form riêng vì HTML không cho lồng <form> trong <form>.
 */
export function ThreadsPanel({ data }: { data: ThreadsPanelData }) {
	const navigation = useNavigation();
	const busy = navigation.state === "submitting";
	const intent = navigation.formData?.get("intent");

	// Mặc định 10:00 sáng mai — mốc hay dùng nhất khi soạn bài tối hôm trước
	const [scheduleAt, setScheduleAt] = useState(() => vnLocalAt(1, 10));

	return (
		<section className="card p-4 lg:p-5">
			<div className="mb-1 flex items-center justify-between gap-3">
				<h2 className="font-semibold text-ink-900">Đăng lên Threads</h2>
				{data.ready && (
					<span className="text-xs text-ink-400">qua {data.socialSetName}</span>
				)}
			</div>

			{!data.ready ? (
				<div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
					<p className="flex items-center gap-2 font-medium">
						<AlertIcon className="h-4.5 w-4.5 shrink-0" />
						Chưa kết nối Typefully
					</p>
					<p className="mt-1.5 text-amber-700">
						{data.hasApiKey
							? "Đã có API key nhưng chưa chọn tài khoản đăng bài."
							: "Cần dán API key của Typefully rồi chọn tài khoản đăng bài."}
					</p>
					<Link
						to="/admin/cai-dat#threads"
						className="btn-outline btn-sm mt-3 !border-amber-300 !text-amber-800 hover:!bg-amber-100"
					>
						<SettingsIcon className="h-4 w-4" />
						Mở trang Cài đặt
					</Link>
				</div>
			) : (
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="post-threads" />

					<div>
						<label htmlFor="caption" className="field-label">
							Nội dung bài đăng
						</label>
						<textarea
							id="caption"
							name="caption"
							rows={10}
							defaultValue={data.captionPreview}
							className="field font-mono text-sm leading-relaxed"
						/>
						<p className="mt-1 text-xs text-ink-400">
							Soạn sẵn từ mẫu trong Cài đặt — sửa thoải mái trước khi đăng.
							{data.imageCount > 0
								? ` Bài sẽ kèm ${data.imageCount} ảnh đầu tiên của sản phẩm.`
								: " Sản phẩm chưa có ảnh nên bài chỉ có chữ."}
						</p>
					</div>

					<div className="rounded-xl bg-ink-50 p-3.5">
						<label htmlFor="scheduleAt" className="field-label">
							Hẹn giờ đăng <span className="font-normal text-ink-400">(giờ Việt Nam)</span>
						</label>
						<div className="flex flex-wrap items-center gap-2">
							<input
								id="scheduleAt"
								name="scheduleAt"
								type="datetime-local"
								value={scheduleAt}
								min={vnLocalInput(5)}
								onChange={(event) => setScheduleAt(event.target.value)}
								className="field !w-auto !py-2 text-sm"
							/>
							<button
								type="submit"
								name="mode"
								value="schedule"
								disabled={busy}
								className="btn-primary btn-md"
							>
								{busy && intent === "post-threads" ? "Đang xử lý..." : "Hẹn giờ đăng"}
							</button>
						</div>

						<div className="mt-2.5 flex flex-wrap gap-1.5">
							{QUICK_SLOTS.map((slot) => (
								<button
									key={slot.label}
									type="button"
									onClick={() => setScheduleAt(slot.value())}
									className="chip !py-1 text-xs"
								>
									{slot.label}
								</button>
							))}
						</div>

						<p className="mt-2.5 text-xs text-ink-500">
							Typefully giữ bài và tự đăng đúng giờ — không cần mở máy hay vào web.
						</p>
					</div>

					<div className="flex flex-wrap gap-2">
						<button
							type="submit"
							name="mode"
							value="now"
							disabled={busy}
							className="btn-outline btn-md"
						>
							Đăng ngay
						</button>
						<button
							type="submit"
							name="mode"
							value="draft"
							disabled={busy}
							className="btn-ghost btn-md"
						>
							Chỉ lưu nháp
						</button>
					</div>
				</Form>
			)}

			{data.posts.length > 0 && (
				<div className="mt-5 border-t border-ink-100 pt-4">
					<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
						Lịch sử đăng
					</p>
					<ul className="space-y-2.5">
						{data.posts.map((post) => (
							<PostRow key={post.id} post={post} busy={busy} />
						))}
					</ul>
				</div>
			)}
		</section>
	);
}

function PostRow({ post, busy }: { post: SocialPost; busy: boolean }) {
	const cancellable = post.status === "scheduled" || post.status === "draft";

	return (
		<li className="text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<span className={cn("badge", POST_STATUS_STYLE[post.status])}>
					{POST_STATUS_LABEL[post.status]}
				</span>

				{post.scheduled_at ? (
					<span className="text-xs font-medium text-blue-700">
						{formatDateTime(post.scheduled_at)}
					</span>
				) : (
					<span className="text-xs text-ink-500">{formatDateTime(post.created_at)}</span>
				)}

				{post.media_count > 0 && (
					<span className="text-xs text-ink-400">{post.media_count} ảnh</span>
				)}

				{post.published_url && (
					<a
						href={post.published_url}
						target="_blank"
						rel="noreferrer noopener"
						className="text-xs font-medium text-brand-600 hover:underline"
					>
						Xem bài
					</a>
				)}

				{cancellable && (
					<Form
						method="post"
						onSubmit={(event) => {
							if (!confirm("Huỷ bài này? Bản nháp trên Typefully cũng sẽ bị xoá.")) {
								event.preventDefault();
							}
						}}
					>
						<input type="hidden" name="intent" value="cancel-threads" />
						<input type="hidden" name="postId" value={post.id} />
						<button
							type="submit"
							disabled={busy}
							className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ink-400 hover:bg-red-50 hover:text-red-600"
						>
							<TrashIcon className="h-3.5 w-3.5" />
							Huỷ
						</button>
					</Form>
				)}
			</div>

			{post.error && <p className="mt-0.5 text-xs text-red-600">{post.error}</p>}
		</li>
	);
}

/** Dải thông báo kết quả sau khi bấm đăng */
export function ThreadsResultBanner({
	message,
	error,
	url,
}: {
	message?: string | null;
	error?: string | null;
	url?: string | null;
}) {
	if (error) {
		return (
			<p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
				<AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
				<span>{error}</span>
			</p>
		);
	}
	if (!message) return null;
	return (
		<p className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
			<CheckIcon className="h-4 w-4 shrink-0" />
			{message}
			{url && (
				<a
					href={url}
					target="_blank"
					rel="noreferrer noopener"
					className="font-semibold underline"
				>
					Mở trên Typefully
				</a>
			)}
		</p>
	);
}
