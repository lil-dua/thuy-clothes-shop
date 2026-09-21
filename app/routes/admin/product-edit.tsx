import { Link, data, useSearchParams } from "react-router";
import type { Route } from "./+types/product-edit";
import { ProductForm } from "~/components/admin/product-form";
import { PageHeader } from "~/components/admin/ui";
import { CheckIcon } from "~/components/icons";
import { getCategories, getProductById } from "~/lib/db.server";
import { parseProductForm, saveProduct } from "~/lib/product-form.server";

export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: `${data?.product.name ?? "Sửa sản phẩm"} — Lumi Admin` },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ params, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const [product, categories] = await Promise.all([
		getProductById(db, id),
		getCategories(db),
	]);
	if (!product) throw new Response("Không tìm thấy sản phẩm", { status: 404 });

	return { product, categories };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw new Response("Không tìm thấy", { status: 404 });

	const form = await request.formData();
	const { values, errors } = parseProductForm(form);
	if (Object.keys(errors).length > 0) return data({ errors, saved: false }, { status: 400 });

	const result = await saveProduct(env.DB, env.IMAGES, form, values, id);
	if (!result.ok) return data({ errors: result.errors, saved: false }, { status: 400 });

	return data({ errors: undefined, saved: true });
}

export default function ProductEdit({ loaderData, actionData }: Route.ComponentProps) {
	const { product, categories } = loaderData;
	const [searchParams] = useSearchParams();
	const justCreated = searchParams.get("luu") === "1";

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

			{(actionData?.saved || justCreated) && (
				<p className="mb-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
					<CheckIcon className="h-4 w-4" />
					{justCreated ? "Đã tạo sản phẩm thành công." : "Đã lưu thay đổi."}
				</p>
			)}

			<ProductForm
				key={product.updated_at}
				categories={categories}
				product={product}
				errors={actionData?.errors}
			/>
		</>
	);
}
