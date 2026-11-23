// Actual Web page/auth client and email domain service; local Redis and captured Resend only.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EmailCodeService} from '../../../../api/src/domain/emailCode.ts';
import {EmailChallengeRepo} from '../../../../api/src/infra/repository/redisEmailChallenge.ts';
import {RedisClient} from '../../../../api/src/infra/repository/redisClient.ts';
import {startEmailRedisFixture} from '../../../../api/test/runtime/emailRedisFixture.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const {createServer} = await import(require.resolve('vite'));
const builder = createRequire(require.resolve('nuxt/package.json')).resolve('@nuxt/vite-builder');
const {default: vue} = await import(createRequire(builder).resolve('@vitejs/plugin-vue'));
const port = Number(process.argv[2] || 4296), origin = `http://localhost:${port}`;
const redis = await startEmailRedisFixture();
const env = {RUN_TYPE: 'dev', RESEND_API_KEY: 'fixture-only', FRONT_END_URL: origin, UPSTASH_REDIS_REST_URL: redis.url, UPSTASH_REDIS_REST_TOKEN: 'fixture-only'};
const codes = new EmailCodeService(new EmailChallengeRepo(() => new RedisClient(env)));
const runtime = path.join(root, 'tests/fixtures/email-link/runtime.ts');
const receipts = [];
const token = Buffer.from('{"alg":"fixture"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({id: 1, uuid: 'email-link-fixture', exp: Math.floor(Date.now()/1000)+3600})).toString('base64url') + '.fixture';
const server = await createServer({root, configFile: false, cacheDir: `node_modules/.vite-email-link-${port}`,
  define: {'import.meta.client': 'true', 'import.meta.server': 'false'},
  server: {host: '127.0.0.1', port, strictPort: true, fs: {allow: [path.resolve(root, '../..')]}},
  resolve: {alias: [{find: '~/stores/user', replacement: runtime}, {find: '~', replacement: path.join(root, 'app')}]},
  plugins: [{name: 'email-link-preview', enforce: 'pre', transform(source, id) {
    if (id.includes('?')) return;
    if (id.endsWith('/app/pages/email-login.vue')) return source.replace('<script setup lang="ts">', `<script setup lang="ts">\nimport {computed} from 'vue';\nimport {useI18n} from 'vue-i18n';\nimport {useHead} from '${runtime}';`).replace(/^definePageMeta\(.*$/m, '');
    if (id.endsWith('/app/composables/useEmailLinkLogin.ts')) return `import {useAuth, useRuntimeConfig, navigateTo} from '${runtime}';\n${source}`;
    if (id.endsWith('/app/composables/useAuth.ts')) return `import {useRuntimeConfig} from '${runtime}';\nimport {request} from '~/utils/request';\n${source}`;
    if (id.endsWith('/app/utils/request.ts')) return `import {useRuntimeConfig, useAuth, navigateTo, tryUseNuxtApp, useRequestHeaders} from '${runtime}';\n${source}`;
  }, configureServer(vite) {vite.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, origin);
    const json = (body, status = 200) => {res.statusCode = status; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body));};
    const html = body => {res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><main style="font:16px system-ui;max-width:680px;margin:60px auto;padding:20px">${body}</main>`);};
    try {
      if (url.pathname === '/') return html('<h1>邮件链接登录联调</h1><p>本地合成邮箱，使用真实页面、验证服务和 Redis；不会发送真实邮件。</p><p><a href="/__preview/new">体验未登录链接登录</a></p><p><a href="/__preview/existing">体验已有账号时打开链接</a></p><p><a href="/__preview/used">体验已使用链接</a></p>');
      if (url.pathname.startsWith('/__preview/')) {
        const existing = url.pathname === '/__preview/existing';
        res.setHeader('Set-Cookie', `slax_email_link_preview=${existing ? token : ''}; Path=/; SameSite=Lax${existing ? '' : '; Max-Age=0'}`);
        let mail;
        const email = `review+${randomUUID()}@example.test`;
        const challenge = await codes.sendCode(env, {purpose: 'login', emailKey: email, deliveryEmail: email, clientIp: '127.0.0.1', deviceId: randomUUID(), locale: 'zh'}, async (_url, options) => {mail = JSON.parse(options.body); return Response.json({id: 'captured-local-only'});});
        const link = mail.text.match(/http:\/\/\S+/)[0];
        if (url.pathname === '/__preview/used') await codes.verifyCode(env, {purpose: 'login', email, request_id: challenge.request_id, code: mail.text.match(/\b\d{6}\b/)[0]});
        return html(`<h1>本地捕获的登录邮件</h1><pre style="white-space:pre-wrap">${mail.text}</pre><p><a href="${link}">点击邮件链接继续</a></p><p><a href="/">返回测试入口</a></p>`);
      }
      if (url.pathname === '/api/v1/user/login') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        receipts.push({type: body.type, email: body.email});
        await codes.verifyLink(env, body);
        return json({code: 200, data: {token, user_id: '1', login_type: 'email'}});
      }
      if (url.pathname === '/api/auth/session') {res.setHeader('Set-Cookie', `slax_email_link_preview=${token}; Path=/; SameSite=Lax`); res.statusCode = 204; return res.end();}
      if (url.pathname === '/bookmarks') return html('<h1>登录已完成</h1><p>真实 Web 登录方法已写入本地测试会话，并跳转到原有书签入口。本页为合成账号的测试回执。</p><a href="/">返回测试入口</a>');
      if (url.pathname === '/login') return html('<h1>重新发送邮件</h1><a href="/__preview/new">发送一封新的本地测试邮件</a>');
      if (url.pathname === '/__receipts') return json(receipts);
      if (url.pathname === '/email-login' || url.pathname === '/email-login-web') {
        const {emailLoginStartupScript} = await vite.ssrLoadModule('/app/utils/emailLinkAuth.ts');
        res.setHeader('Content-Type', 'text/html;charset=utf-8');
        return res.end(await vite.transformIndexHtml(url.pathname, `<!doctype html><html lang="zh" data-slax-theme="${['light', 'dark', 'eink'].includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : 'light'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>${emailLoginStartupScript}</script><meta name="email-proof-trap"><script>document.querySelector('meta[name="email-proof-trap"]').setAttribute('content',location.hash);</script></head><body><div id="app"></div><script type="module" src="/tests/fixtures/email-link/main.ts"></script></body></html>`));
      }
      next();
    } catch (error) {return json({code: 400, data: error.name, message: 'Login proof rejected'}, 400);}
  });}}, vue()]
});
await server.listen();
console.log(`Email link preview: ${origin}`);
let stopping = false;
async function stop() {if (stopping) return; stopping = true; await server.close(); await redis.dispose(); process.exit();}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
