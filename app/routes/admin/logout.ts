import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { logout } from "~/lib/auth.server";

/**
 * Đăng xuất chỉ chấp nhận POST: nếu dùng GET, một thẻ <img> hay link trên
 * trang khác có thể vô tình đăng xuất chủ shop.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const setCookie = await logout(context.cloudflare.env.DB, request);
	return redirect("/admin/dang-nhap", { headers: { "Set-Cookie": setCookie } });
}

export function loader() {
	return redirect("/admin");
}
