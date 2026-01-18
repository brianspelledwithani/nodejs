const express = require("express");

const router = express.Router();

const HEALTHIE_MUTATION = `
  mutation CreateReferringProvider($input: createReferringPhysicianInput!) {
    createReferringPhysician(input: $input) {
      referring_physician { id }
      duplicated_physician { id }
      messages { field message }
    }
  }
`;

const AUTHORIZER_MUTATION = `
  mutation ($params: SignUpInput!) {
    signup(params: $params) { message }
  }
`;

class ApiError extends Error {
  constructor(message, status = 500, code = "SERVER_ERROR", details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(
      `Missing required environment variable: ${name}`,
      500,
      "CONFIG_ERROR"
    );
  }
  return value;
}

function parseJsonSafe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function getGraphQlErrorMessage(body, fallback) {
  return body?.errors?.[0]?.message || body?.message || fallback;
}

function isAuthorizerDuplicate(message) {
  return /already exists|user exists|duplicate/i.test(message || "");
}

function normalizeSignupInput(payload = {}) {
  const toTrimmedString = (value) => (typeof value === "string" ? value.trim() : "");
  return {
    firstName: toTrimmedString(payload.firstName),
    lastName: toTrimmedString(payload.lastName),
    practiceName: toTrimmedString(payload.practiceName),
    npi: toTrimmedString(payload.npi).replace(/\D/g, ""),
    email: toTrimmedString(payload.email),
    phone: toTrimmedString(payload.phone).replace(/\D/g, ""),
    password: typeof payload.password === "string" ? payload.password : "",
  };
}

function validateFields(input, requiredFields) {
  return requiredFields.filter((field) => !input[field]);
}

async function createReferringProvider(input) {
  const healthieUrl =
    process.env.HEALTHIE_GRAPHQL_URL || "https://api.gethealthie.com/graphql";
  const auth = requireEnv("HEALTHIE_AUTHORIZATION");
  const authSource = process.env.HEALTHIE_AUTH_SOURCE || "API";

  const response = await fetch(healthieUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
      AuthorizationSource: authSource,
    },
    body: JSON.stringify({
      query: HEALTHIE_MUTATION,
      variables: {
        input: {
          first_name: input.firstName,
          last_name: input.lastName,
          business_name: input.practiceName,
          phone_number: input.phone,
          email: input.email,
          npi: input.npi,
          other_id: "InsomniaRX",
        },
      },
    }),
  });

  const body = await parseJsonSafe(await response.text());

  if (!response.ok || body?.errors?.length) {
    throw new ApiError(
      getGraphQlErrorMessage(body, "Unable to create referring provider in Healthie."),
      502,
      "HEALTHIE_ERROR",
      body?.errors
    );
  }

  const result = body?.data?.createReferringPhysician;
  if (!result) {
    throw new ApiError(
      "Unable to create referring provider in Healthie.",
      502,
      "HEALTHIE_ERROR"
    );
  }

  const messages = Array.isArray(result.messages) ? result.messages : [];
  const message = messages.find((entry) => entry?.message)?.message || "";

  const providerId =
    result?.referring_physician?.id || result?.duplicated_physician?.id || null;

  if (!providerId) {
    throw new ApiError(
      message || "Unable to create referring provider in Healthie.",
      422,
      "HEALTHIE_CREATE_FAILED",
      messages
    );
  }

  return {
    duplicated: Boolean(result.duplicated_physician),
    message: message || undefined,
    id: String(providerId), // ✅ Healthie provider id
  };
}

async function createAuthorizerUser(input, healthieProviderId) {
  const authorizerUrl =
    process.env.AUTHORIZER_GRAPHQL_URL ||
    "https://authorizer-production-8e06.up.railway.app/graphql";
  const adminSecret = requireEnv("AUTHORIZER_ADMIN_SECRET");

  const response = await fetch(authorizerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-authorizer-admin-secret": adminSecret,
    },
    body: JSON.stringify({
      query: AUTHORIZER_MUTATION,
      variables: {
        params: {
          email: input.email,
          password: input.password,
          confirm_password: input.password,
          roles: ["user"],

          // ✅ Correct Authorizer field names
          given_name: input.firstName,
          family_name: input.lastName,

          // ✅ Save provider phone into Authorizer phone_number
          phone_number: input.phone,

          // ✅ OPTION 1: store practice name safely in app_data (JSON)
          app_data: {
            practice_name: input.practiceName,
          },

          // ✅ Save Healthie provider id into Authorizer profile nickname
          nickname: String(healthieProviderId),
        },
      },
    }),
  });

  const body = await parseJsonSafe(await response.text());

  if (!response.ok || body?.errors?.length) {
    const message = getGraphQlErrorMessage(body, "Unable to create Authorizer account.");
    if (isAuthorizerDuplicate(message)) {
      return { duplicated: true };
    }
    throw new ApiError(message, 502, "AUTHORIZER_ERROR", body?.errors);
  }

  if (!body?.data?.signup) {
    throw new ApiError("Unable to create Authorizer account.", 502, "AUTHORIZER_ERROR");
  }

  return { duplicated: false };
}

function handleApiError(res, error) {
  const status = error?.status || 500;
  res.status(status).json({
    message: error?.message || "Unable to create provider account.",
    code: error?.code || "PROVIDER_SIGNUP_FAILED",
    details: error?.details,
  });
}

router.post("/signup", async (req, res) => {
  const input = normalizeSignupInput(req.body);

  const missing = validateFields(input, [
    "firstName",
    "lastName",
    "practiceName",
    "npi",
    "email",
    "phone",
    "password",
  ]);

  if (missing.length) {
    return res.status(400).json({ message: "Missing required fields.", fields: missing });
  }

  try {
    // 1) Create provider in Healthie first (get provider id)
    const healthie = await createReferringProvider(input);

    // 2) Create Authorizer user and set nickname to Healthie provider id
    const authorizer = await createAuthorizerUser(input, healthie.id);

    return res.json({ healthie, authorizer });
  } catch (error) {
    return handleApiError(res, error);
  }
});

module.exports = router;
