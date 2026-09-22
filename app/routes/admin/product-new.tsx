import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/product-new";
import { ProductForm } from "~/components/admin/product-form";
import { PageHeader } from "~/components/admin/ui";
import { getCategories, getProductById } from "~/lib/db.server";
import { parseProductForm, saveProduct } from "~/lib/product-form.server";
import { getSecret, getSettings, hasSecret } from "~/lib/settings.server";
import { postProductToThreads } from "~/lib/threads.server";

export function meta() {
	return [{ title: "Thêm sản phẩm — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const db = env.DB;
	const envRecord = env as unknown as Record<string, unknown>;

	const [categories, settings, apiKeySet] = await Promise.all([
		getCategories(db),
		getSettings(db),
		hasSecret(db, "typefully_api_key", envRecord),
	]);

	return {
		categories,
		threadsToggle: {
			available: apiKeySet && Boolean(settings.typefully_social_set_id),
			defaultOn: settings.threads_auto_post === "1",
		},
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const form = await request.formData();
	const { values, errors } = parseProductForm(form);

	if (Object.keys(errors).length > 0) return data({ errors }, { status: 400 });

	const result = await saveProduct(env.DB, env.IMAGES, form, values);
	if (!result.ok) return data({ errors: result.errors }, { status: 400 });

	// Đăng Threads ngay sau khi lưu, nếu chủ shop tích ô đó.
	// Lỗi đăng KHÔNG làm hỏng việc tạo sản phẩm — sản phẩm đã lưu rồi, chỉ báo
	// lại để chủ shop thử đăng tay ở trang sửa.
	let threads: "posted" | "failed" | null = null;
	if (form.get("postToThreads") === "on") {
		const [product, settings, apiKey] = await Promise.all([
			getProductById(env.DB, result.id),
			getSettings(env.DB),
			getSecret(env.DB, "typefully_api_key", env as unknown as Record<string, unknown>),
		]);

		if (product && apiKey) {
			const posted = await postProductToThreads(
				env.DB,
				env.IMAGES,
				apiKey,
				settings,
				product,
				{ publishAt: "now", shopUrl: new URL(request.url).origin },
			);
			threads = posted.ok ? "posted" : "failed";
		} else {
			threads = "failed";
		}
	}

	const query = new URLSearchParams({ luu: "1" });
	if (threads) query.set("threads", threads);
	return redirect(`/admin/san-pham/${result.id}?${query.toString()}`);
}

export default function ProductNew({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<>
			<PageHeader
				title="Thêm sản phẩm"
				description="Điền thông tin, giá và tồn kho theo từng size"
				action={
					<Link to="/admin/san-pham" className="btn-ghost btn-md">
						← Danh sách sản phẩm
					</Link>
				}
			/>
			<ProductForm
				categories={loaderData.categories}
				errors={actionData?.errors}
				threadsToggle={loaderData.threadsToggle}
			/>
		</>
	);
}
