import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/product-new";
import { ProductForm } from "~/components/admin/product-form";
import { PageHeader } from "~/components/admin/ui";
import { getCategories } from "~/lib/db.server";
import { parseProductForm, saveProduct } from "~/lib/product-form.server";

export function meta() {
	return [{ title: "Thêm sản phẩm — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
	return { categories: await getCategories(context.cloudflare.env.DB) };
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const form = await request.formData();
	const { values, errors } = parseProductForm(form);

	if (Object.keys(errors).length > 0) return data({ errors }, { status: 400 });

	const result = await saveProduct(env.DB, env.IMAGES, form, values);
	if (!result.ok) return data({ errors: result.errors }, { status: 400 });

	return redirect(`/admin/san-pham/${result.id}?luu=1`);
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
			<ProductForm categories={loaderData.categories} errors={actionData?.errors} />
		</>
	);
}
