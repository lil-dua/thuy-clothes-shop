import { Form, Link, data, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { getAdminUser, login } from "~/lib/auth.server";

export function meta() {
	return [{ title: "Đăng nhập quản trị — Lumi" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	// Đã đăng nhập rồi thì vào thẳng trang quản trị
	const user = await getAdminUser(context.cloudflare.env.DB, request);
	if (user) throw redirect("/admin");
	return null;
}

export async function action({ request, context }: Route.ActionArgs) {
	const form = await request.formData();
	const username = String(form.get("username") ?? "");
	const password = String(form.get("password") ?? "");
	const next = String(form.get("next") ?? "/admin");

	if (!username || !password) {
		return data({ error: "Vui lòng nhập tên đăng nhập và mật khẩu" }, { status: 400 });
	}

	const result = await login(context.cloudflare.env.DB, username, password);
	if (!result.ok) return data({ error: result.error }, { status: 401 });

	// Chỉ cho phép quay về đường dẫn nội bộ trong khu vực quản trị
	const safeNext = next.startsWith("/admin") ? next : "/admin";
	return redirect(safeNext, { headers: { "Set-Cookie": result.setCookie! } });
}

export default function AdminLogin({ actionData }: Route.ComponentProps) {
	const [searchParams] = useSearchParams();
	const navigation = useNavigation();

	return (
		<div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-100 via-brand-50 to-white px-4">
			<div className="w-full max-w-sm">
				<div className="text-center">
					<Link to="/" className="text-3xl font-bold text-brand-500">
						Lumi<span className="text-brand-300">*</span>
					</Link>
					<p className="mt-1 text-sm text-ink-500">Khu vực quản trị</p>
				</div>

				<Form method="post" className="card mt-6 space-y-4 p-6 shadow-sm">
					<input type="hidden" name="next" value={searchParams.get("next") ?? "/admin"} />

					<div>
						<label htmlFor="username" className="field-label">
							Tên đăng nhập
						</label>
						<input
							id="username"
							name="username"
							required
							autoFocus
							autoComplete="username"
							autoCapitalize="none"
							className="field"
						/>
					</div>

					<div>
						<label htmlFor="password" className="field-label">
							Mật khẩu
						</label>
						<input
							id="password"
							name="password"
							type="password"
							required
							autoComplete="current-password"
							className="field"
						/>
					</div>

					{actionData?.error && (
						<p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
							{actionData.error}
						</p>
					)}

					<button
						type="submit"
						disabled={navigation.state === "submitting"}
						className="btn-primary btn-lg w-full"
					>
						{navigation.state === "submitting" ? "Đang đăng nhập..." : "Đăng nhập"}
					</button>
				</Form>

				<Link
					to="/"
					className="mt-4 block text-center text-sm text-ink-500 hover:text-brand-600"
				>
					← Về trang bán hàng
				</Link>
			</div>
		</div>
	);
}
