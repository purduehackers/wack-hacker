import { EVERGREEN_WIKI_URL, EVERGREEN_WIKI_USER, EVERGREEN_WIKI_ENDPOINT } from "./consts";
import { env } from "../env";

function extractCookies(rawHeaders:any) {
	const set = rawHeaders.getSetCookie();
	const done = set.map((s:any) => s.split(";")[0]).join("; ");
	console.log(`extracted cookies ${done}`);
	return done;
}

async function getToken(tokenType:`csrf`|`login`, cookieStr:string = "") {
	const res = await fetch(`${EVERGREEN_WIKI_URL}${EVERGREEN_WIKI_ENDPOINT}?action=query&meta=tokens&type=${tokenType}&format=json`, {
		headers: cookieStr ? { Cookie: cookieStr } : {},
	});
	const data = await res.json();
	console.log(`(${tokenType}) got token data: `, data);
	const pathed = (<any>data).query.tokens;
	return ((tokenType == `csrf`) ? pathed.csrftoken : pathed.logintoken);
}

async function login() {
	console.log(`getting token...`);
	const token = await getToken(`login`);
	const params = new URLSearchParams({
		action: "login",
		format: "json",
		lgname: EVERGREEN_WIKI_USER,
		lgpassword: env.MEDIAWIKI_BOT_KEY,
		lgtoken: token
	});
	console.log(`logging in...`);
	const res = await fetch(EVERGREEN_WIKI_URL+EVERGREEN_WIKI_ENDPOINT, {
		method: "POST",
		headers: { 
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params
	});

	const body = await res.json();

	const cookies = extractCookies(res.headers);

	if (!body?.ok) {
		console.log(`Login failed: `, body);
		throw new Error("MediaWiki login failed");
	}
	console.log(`got token!`, body);
	return cookies;
}

export async function appendMediaWikiPage(pageTitle:string, appendText:string, description:string) {
	const cookiesStr = await login();
	const token = await getToken(`csrf`, cookiesStr);
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
			Cookie: cookiesStr
		},
		body: params
	});
	const trueRes = await res2.json();

	// check for captcha
	if (trueRes?.edit?.captcha) {
		console.error("Edit requires CAPTCHA:", trueRes.edit.captcha);
	}
	console.log(trueRes);
	console.log(`MW - posted:`);

	return trueRes;
}