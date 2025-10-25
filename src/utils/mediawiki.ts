import { EVERGREEN_WIKI_URL, EVERGREEN_WIKI_USER, EVERGREEN_WIKI_ENDPOINT } from "./consts";
import { env } from "../env";

function extractCookiesFromResponse(res: Response): string {
	// Try getSetCookie() (supported in some runtimes) and fall back to get('set-cookie').
	// Return "name=value; name2=value2" suitable for a Cookie header.
	const headers: any = (res as any).headers;
	// getSetCookie may exist and return array
	if (typeof headers.getSetCookie === "function") {
		const set = headers.getSetCookie(); // string[]
		if (Array.isArray(set) && set.length) {
			// strip attributes like 'Path=...' and keep name=value
			return set.map((s: string) => s.split(";")[0]).join("; ");
		}
	}
	// fallback: headers.get('set-cookie') may be a string (possibly comma-joined)
	const sc = headers.get ? headers.get("set-cookie") : null;
	if (sc) {
		// split carefully: a server should send multiple Set-Cookie headers; some fetch impls combine them with ','
		// naive split on ', ' may break cookie values containing commas; we assume simple cookies.
		// To be safer: split on /(?<=;)\s*(?=[^;=]+=)/ is complex; here we split on ', ' which covers common cases.
		const parts = sc.split(", ").map((s: string) => s.split(";")[0]);
		return parts.join("; ");
	}
	return ``;
}

async function getToken(tokenType:'csrf'|'login', cookieStr:string=""): Promise<{token:string, cookies:string}> {
	const headers: any = {
		"User-Agent": EVERGREEN_WIKI_USER
	};
	if (cookieStr) {
		headers.Cookie = cookieStr;
	}

	const res = await fetch(`${EVERGREEN_WIKI_URL}${EVERGREEN_WIKI_ENDPOINT}?action=query&meta=tokens&type=${tokenType}&format=json`, {
		headers
	});
	const data = await res.json();
	const cookies = extractCookiesFromResponse(res);

	const pathed = (data as any).query.tokens;
	const token = (tokenType === 'csrf') ? pathed.csrftoken : pathed.logintoken;
	return { token, cookies };
}

async function login(): Promise<string> {
	// first request: get login token AND the session cookies that came with it
	const { token: loginToken, cookies: initialCookies } = await getToken('login');

	// prepare form
	const params = new URLSearchParams({
		action: "login",
		format: "json",
		lgname: EVERGREEN_WIKI_USER,
		lgpassword: env.MEDIAWIKI_BOT_KEY,
		lgtoken: loginToken
	});

	const res = await fetch(EVERGREEN_WIKI_URL + EVERGREEN_WIKI_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": EVERGREEN_WIKI_USER,
			//send the cookies we got from the token request
			...(initialCookies ? { Cookie: initialCookies } : {})
		},
		body: params
	});

	const body = await res.json();
	// cookies returned from the login POST (may replace session cookies)
	const loginCookies = extractCookiesFromResponse(res);

	if (!body?.login || body.login.result !== "Success") {
		throw new Error("MediaWiki login failed: " + JSON.stringify(body));
	}
	// Return the cookies we should use going forward (prefer cookies from the login POST,
	// but fall back to the initialCookies if server didn't set new ones)
	return loginCookies || initialCookies;
}

export async function appendMediaWikiPage(pageTitle:string, appendText:string, description:string) {
	const cookiesStr = await login();

	// Now request a csrf token using the cookies we got from login
	const { token: token } = await getToken('csrf', cookiesStr);

	const params = new URLSearchParams({
		action: `edit`,
		format: `json`,
		title: pageTitle,
		appendtext: appendText,
		summary: description,
		token: token
	});

	//actual writing finally
	const res2 = await fetch(EVERGREEN_WIKI_URL+EVERGREEN_WIKI_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": EVERGREEN_WIKI_USER,
			Cookie: cookiesStr
		},
		body: params
	});
	const trueRes = await res2.json();

	// check for captcha
	if (trueRes?.edit?.captcha) {
		console.error("Edit requires CAPTCHA:", trueRes.edit.captcha);
	}

	return trueRes;
}