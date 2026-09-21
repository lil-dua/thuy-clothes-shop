import {
	isRouteErrorResponse,
	Link,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		// Be Vietnam Pro được thiết kế riêng cho tiếng Việt — dấu không bị
		// chồng lên chữ như nhiều font sans phổ thông.
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="vi">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="theme-color" content="#ea5586" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let title = "Đã có lỗi xảy ra";
	let description = "Vui lòng thử lại sau ít phút.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		if (error.status === 404) {
			title = "Không tìm thấy trang";
			description = "Trang bạn tìm không tồn tại hoặc đã được chuyển đi.";
		} else {
			title = `Lỗi ${error.status}`;
			description = error.statusText || description;
		}
	} else if (import.meta.env.DEV && error instanceof Error) {
		description = error.message;
		stack = error.stack;
	}

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
			<p className="text-6xl">🫧</p>
			<h1 className="text-2xl font-bold text-ink-900">{title}</h1>
			<p className="max-w-md text-ink-500">{description}</p>
			<Link to="/" className="btn-primary btn-md mt-2">
				Về trang chủ
			</Link>
			{stack && (
				<pre className="mt-6 max-w-full overflow-x-auto rounded-xl bg-ink-100 p-4 text-left text-xs">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
