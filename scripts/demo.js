process.env.NODE_ENV = "development";
process.env.DEMO_MODE = "1";
process.env.PORT ||= "3000";
process.env.APP_ORIGIN ||= `http://localhost:${process.env.PORT}`;

await import("../server/index.js");
