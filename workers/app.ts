import { createRequestHandler } from "react-router";
import { releaseExpiredOrders } from "../app/lib/order.server";
import { getSecret, getSettings } from "../app/lib/settings.server";
import { syncScheduledPosts } from "../app/lib/threads.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},

	/**
	 * Chạy theo lịch trong wrangler.json (mỗi 15 phút).
	 *
	 * Hai việc, đều là dọn dẹp nền:
	 *
	 * 1. Trả kho cho đơn chuyển khoản/MoMo quá hạn giữ chỗ. Trong request cũng
	 *    đã làm việc này, nhưng nếu cả đêm không ai vào web thì hàng vẫn bị giữ
	 *    treo tới sáng — cron lấp đúng khoảng đó.
	 *
	 * 2. Hỏi lại Typefully xem bài đã hẹn giờ lên sóng chưa. Việc ĐĂNG là của
	 *    Typefully, cron không đăng hộ; nó chỉ cập nhật lại trạng thái để trang
	 *    quản trị không hiển thị "Đã hẹn giờ" mãi sau khi bài đã đăng xong.
	 */
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(
			(async () => {
				const released = await releaseExpiredOrders(env.DB);
				if (released > 0) {
					console.log(`[cron] đã huỷ và hoàn kho ${released} đơn quá hạn`);
				}

				const apiKey = await getSecret(
					env.DB,
					"typefully_api_key",
					env as unknown as Record<string, unknown>,
				);
				if (!apiKey) return;

				const settings = await getSettings(env.DB);
				const synced = await syncScheduledPosts(env.DB, apiKey, settings);
				if (synced > 0) {
					console.log(`[cron] đã cập nhật trạng thái ${synced} bài đăng`);
				}
			})(),
		);
	},
} satisfies ExportedHandler<Env>;
