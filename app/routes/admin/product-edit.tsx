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
	getProductPosts,
	postProductToThreads,
} from "~/lib/threads.server";

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

	const [product, categories, settings, posts] = await Promise.all([
		getProductById(db, id),
		getCategories(db),
		getSettings(db),
		getProductPosts(db, id),
	]);
	if (!product) throw new Response("Không tìm thấy sản phẩm", { status: 404 });

	// API key không bao giờ rời server — chỉ gửi xuống trạng thái có/không
	const apiKey = await getSecret(db, "typefully_api_key", env as unknown as Record<string, unknown>);

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

		const publishNow = form.get("publishNow") !== "0";
		const result = await postProductToThreads(
			env.DB,
			env.IMAGES,
			apiKey,
			settings,
			product,
			{
				caption: String(form.get("caption") ?? ""),
				publishNow,
				shopUrl: new URL(request.url).origin,
			},
		);

		if (!result.ok) return data({ threadsError: result.error }, { status: 400 });

		return data({
			threadsMessage: publishNow
				? `Đã đăng lên Threads${result.mediaCount > 0 ? ` kèm ${result.mediaCount} ảnh` : ""}.`
				: "Đã lưu bản nháp trên Typefully.",
			threadsUrl: result.privateUrl,
		});
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
				url={actionData && "threadsUrl" in actionData ? actionData.threadsUrl : null}
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
