import { Link, data, useSearchParams } from "react-router";
import type { Route } from "./+types/product-edit";
import { ProductForm } from "~/components/admin/product-form";
import { ThreadsPanel, ThreadsResultBanner } from "~/components/admin/threads-panel";
import { PageHeader } from "~/components/admin/ui";
import { CheckIcon } from "~/components/icons";
import { getCategories, getProductById } from "~/lib/db.server";
import { parseProductForm, saveProduct } from "~/lib/product-form.server";
import { getSecret, getSettings } from "~/lib/settings.server";
import {
	buildCaption,
	cancelScheduledPost,
	getProductPosts,
	postProductToThreads,
	syncScheduledPosts,
} from "~/lib/threads.server";
import { formatDateTime, vnLocalToIso, vnLocalToSqlUtc } from "~/lib/format";

export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: `${data?.product.name ?? "Sửa sản phẩm"} — Lumi Admin` },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const db = env.DB;
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const [product, categories, settings] = await Promise.all([
		getProductById(db, id),
		getCategories(db),
		getSettings(db),
	]);
	if (!product) throw new Response("Không tìm thấy sản phẩm", { status: 404 });

	// API key không bao giờ rời server — chỉ gửi xuống trạng thái có/không
	const apiKey = await getSecret(db, "typefully_api_key", env as unknown as Record<string, unknown>);

	// Cron 15 phút một lần là đủ cho nền, nhưng khi chủ shop đang mở đúng trang
	// này thì đồng bộ luôn để không phải chờ mới thấy bài đã lên sóng.
	if (apiKey) await syncScheduledPosts(db, apiKey, settings, { limit: 5 });
	const posts = await getProductPosts(db, id);

	return {
		product,
		categories,
		threads: {
			ready: Boolean(apiKey && settings.typefully_social_set_id),
			hasApiKey: Boolean(apiKey),
			socialSetName: settings.typefully_social_set_name || "tài khoản đã chọn",
			captionPreview: buildCaption(product, settings, new URL(request.url).origin),
			imageCount: Math.min(product.images.length, 4),
			posts,
		},
	};
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const form = await request.formData();

	// --- Huỷ bài chưa đăng -------------------------------------------------
	if (form.get("intent") === "cancel-threads") {
		const [settings, apiKey] = await Promise.all([
			getSettings(env.DB),
			getSecret(env.DB, "typefully_api_key", env as unknown as Record<string, unknown>),
		]);
		if (!apiKey) {
			return data({ threadsError: "Chưa cấu hình API key Typefully" }, { status: 400 });
		}

		const cancelled = await cancelScheduledPost(
			env.DB,
			apiKey,
			settings,
			Number.parseInt(String(form.get("postId") ?? ""), 10),
		);
		if (!cancelled.ok) return data({ threadsError: cancelled.error }, { status: 400 });
		return data({ threadsMessage: "Đã huỷ bài đăng." });
	}

	// --- Đăng lên Threads -------------------------------------------------
	if (form.get("intent") === "post-threads") {
		const [product, settings, apiKey] = await Promise.all([
			getProductById(env.DB, id),
			getSettings(env.DB),
			getSecret(env.DB, "typefully_api_key", env as unknown as Record<string, unknown>),
		]);
		if (!product) throw new Response("Không tìm thấy sản phẩm", { status: 404 });
		if (!apiKey) {
			return data({ threadsError: "Chưa cấu hình API key Typefully" }, { status: 400 });
		}

		// mode: "now" đăng ngay | "schedule" hẹn giờ | "draft" chỉ lưu nháp
		const mode = String(form.get("mode") ?? "now");
		let publishAt: string | null = null;
		let scheduledAtUtc: string | null = null;

		if (mode === "now") {
			publishAt = "now";
		} else if (mode === "schedule") {
			const local = String(form.get("scheduleAt") ?? "");
			publishAt = vnLocalToIso(local);
			scheduledAtUtc = vnLocalToSqlUtc(local);
			if (!publishAt || !scheduledAtUtc) {
				return data({ threadsError: "Thời điểm hẹn giờ không hợp lệ" }, { status: 400 });
			}
			// Chặn hẹn vào quá khứ: Typefully sẽ từ chối, nhưng báo sớm ở đây thì
			// chủ shop hiểu ngay vì sao thay vì đọc lỗi khó hiểu từ API.
			if (new Date(publishAt).getTime() < Date.now() + 60_000) {
				return data(
					{ threadsError: "Giờ hẹn phải ở tương lai, cách hiện tại ít nhất 1 phút" },
					{ status: 400 },
				);
			}
		}

		const result = await postProductToThreads(
			env.DB,
			env.IMAGES,
			apiKey,
			settings,
			product,
			{
				caption: String(form.get("caption") ?? ""),
				publishAt,
				scheduledAtUtc,
				shopUrl: new URL(request.url).origin,
			},
		);

		if (!result.ok) return data({ threadsError: result.error }, { status: 400 });

		const withMedia = result.mediaCount > 0 ? ` kèm ${result.mediaCount} ảnh` : "";
		const message =
			result.status === "scheduled"
				? `Đã hẹn đăng lúc ${formatDateTime(result.scheduledAt)}${withMedia}. Typefully sẽ tự đăng đúng giờ.`
				: result.status === "published"
					? `Đã đăng lên Threads${withMedia}.`
					: "Đã lưu bản nháp trên Typefully.";

		return data({ threadsMessage: message, threadsUrl: result.privateUrl });
	}

	// --- Lưu sản phẩm ------------------------------------------------------
	const { values, errors } = parseProductForm(form);
	if (Object.keys(errors).length > 0) return data({ errors, saved: false }, { status: 400 });

	const result = await saveProduct(env.DB, env.IMAGES, form, values, id);
	if (!result.ok) return data({ errors: result.errors, saved: false }, { status: 400 });

	return data({ errors: undefined, saved: true });
}

export default function ProductEdit({ loaderData, actionData }: Route.ComponentProps) {
	const { product, categories, threads } = loaderData;
	const [searchParams] = useSearchParams();
	const justCreated = searchParams.get("luu") === "1";

	const saved = actionData && "saved" in actionData ? actionData.saved : false;
	const errors = actionData && "errors" in actionData ? actionData.errors : undefined;
	// Kết quả tự đăng Threads đi kèm lần chuyển trang từ màn thêm sản phẩm
	const autoPost = searchParams.get("threads");

	return (
		<>
			<PageHeader
				title="Sửa sản phẩm"
				description={product.name}
				action={
					<div className="flex gap-2">
						<Link
							to={`/san-pham/${product.slug}`}
							target="_blank"
							rel="noreferrer"
							className="btn-outline btn-md"
						>
							Xem trên website
						</Link>
						<Link to="/admin/san-pham" className="btn-ghost btn-md">
							← Danh sách
						</Link>
					</div>
				}
			/>

			<ThreadsResultBanner
				message={
					actionData && "threadsMessage" in actionData
						? actionData.threadsMessage
						: autoPost === "posted"
							? "Đã đăng sản phẩm lên Threads."
							: null
				}
				error={
					actionData && "threadsError" in actionData
						? actionData.threadsError
						: autoPost === "failed"
							? "Sản phẩm đã lưu nhưng đăng Threads không thành công — xem lỗi ở mục Đăng lên Threads bên dưới."
							: null
				}
				url={
					actionData && "threadsUrl" in actionData
						? (actionData.threadsUrl as string | null)
						: null
				}
			/>

			{(saved || justCreated) && (
				<p className="mb-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
					<CheckIcon className="h-4 w-4" />
					{justCreated ? "Đã tạo sản phẩm thành công." : "Đã lưu thay đổi."}
				</p>
			)}

			<ProductForm
				key={product.updated_at}
				categories={categories}
				product={product}
				errors={errors}
			/>

			<div className="mt-5">
				<ThreadsPanel data={threads} />
			</div>
		</>
	);
}
