const supportedLocales = new Set(["ru", "kk", "en"]);

const authMessages = {
  ru: {
    verificationSubject: "Подтвердите e-mail в Book Meet",
    verificationText: "Вы зарегистрировались в Book Meet. Подтвердите e-mail по ссылке: {link}\n\nПароли не отправляются по e-mail и не содержатся в этом письме.",
    resetSubject: "Восстановление пароля Book Meet",
    resetText: "Чтобы задать новый пароль Book Meet, откройте ссылку: {link}\n\nЕсли это были не вы, просто проигнорируйте письмо. Пароли не отправляются по e-mail и не содержатся в этом письме.",
    googleCreatedSubject: "Регистрация в Book Meet через Google",
    googleCreatedText: "Ваш профиль Book Meet создан через Google. Для входа используйте кнопку Google. Пароли не отправляются по e-mail и не содержатся в этом письме.",
    googleRecoverySubject: "Восстановление доступа Book Meet",
    googleRecoveryText: "Этот профиль Book Meet использует вход через Google. Пароль для него не устанавливается: войдите кнопкой Google. Пароли не отправляются по e-mail и не содержатся в этом письме.",
    invalidCredentials: "Укажите корректный e-mail и пароль не короче 8 знаков",
    usernameInvalid: "Имя пользователя: 3–30 символов, латинские буквы, цифры, точка, дефис или подчёркивание; начало и конец — буква или цифра.",
    usernameReserved: "Это имя пользователя зарезервировано.",
    usernameTaken: "Это имя пользователя уже занято.",
    tooManyAttempts: "Слишком много попыток входа. Попробуйте позже.",
    verificationInvalid: "Ссылка подтверждения недействительна или истекла",
    recoveryGeneric: "Если такой e-mail зарегистрирован, дальнейшие инструкции отправлены.",
    resetInvalid: "Не удалось сохранить новый пароль. Проверьте ссылку и требования к паролю.",
  },
  kk: {
    verificationSubject: "Book Meet жүйесінде e-mail мекенжайын растаңыз",
    verificationText: "Сіз Book Meet жүйесінде тіркелдіңіз. E-mail мекенжайын мына сілтеме арқылы растаңыз: {link}\n\nҚұпиясөздер e-mail арқылы жіберілмейді және бұл хатта көрсетілмейді.",
    resetSubject: "Book Meet құпиясөзін қалпына келтіру",
    resetText: "Book Meet үшін жаңа құпиясөз орнату үшін мына сілтемені ашыңыз: {link}\n\nЕгер бұл сіз болмасаңыз, хатты елемеңіз. Құпиясөздер e-mail арқылы жіберілмейді және бұл хатта көрсетілмейді.",
    googleCreatedSubject: "Google арқылы Book Meet жүйесінде тіркелу",
    googleCreatedText: "Book Meet профиліңіз Google арқылы жасалды. Кіру үшін Google батырмасын пайдаланыңыз. Құпиясөздер e-mail арқылы жіберілмейді және бұл хатта көрсетілмейді.",
    googleRecoverySubject: "Book Meet жүйесіне кіруді қалпына келтіру",
    googleRecoveryText: "Бұл Book Meet профилі Google арқылы кіруді пайдаланады. Оған құпиясөз орнатылмайды: Google батырмасымен кіріңіз. Құпиясөздер e-mail арқылы жіберілмейді және бұл хатта көрсетілмейді.",
    invalidCredentials: "Дұрыс e-mail және кемінде 8 таңбалы құпиясөз енгізіңіз",
    usernameInvalid: "Пайдаланушы аты 3–30 таңбадан тұруы керек: латын әріптері, сандар, нүкте, дефис немесе астыңғы сызық; басы мен соңы әріп не сан.",
    usernameReserved: "Бұл пайдаланушы аты сақталған.",
    usernameTaken: "Бұл пайдаланушы аты бос емес.",
    tooManyAttempts: "Кіру әрекеттері тым көп. Кейінірек қайталап көріңіз.",
    verificationInvalid: "Растау сілтемесі жарамсыз немесе мерзімі өткен",
    recoveryGeneric: "Егер бұл e-mail тіркелген болса, келесі нұсқаулар жіберілді.",
    resetInvalid: "Жаңа құпиясөзді сақтау мүмкін болмады. Сілтеме мен құпиясөз талаптарын тексеріңіз.",
  },
  en: {
    verificationSubject: "Confirm your e-mail for Book Meet",
    verificationText: "You registered with Book Meet. Confirm your e-mail using this link: {link}\n\nPasswords are never sent by e-mail and are not included in this message.",
    resetSubject: "Reset your Book Meet password",
    resetText: "Open this link to set a new Book Meet password: {link}\n\nIf you did not request this, ignore this message. Passwords are never sent by e-mail and are not included in this message.",
    googleCreatedSubject: "Book Meet registration with Google",
    googleCreatedText: "Your Book Meet profile was created with Google. Use the Google button to sign in. Passwords are never sent by e-mail and are not included in this message.",
    googleRecoverySubject: "Restore access to Book Meet",
    googleRecoveryText: "This Book Meet profile uses Google sign-in. It does not have a password: sign in with the Google button. Passwords are never sent by e-mail and are not included in this message.",
    invalidCredentials: "Enter a valid e-mail and a password of at least 8 characters",
    usernameInvalid: "Username must be 3–30 characters of lowercase Latin letters, digits, dots, hyphens, or underscores, starting and ending with a letter or digit.",
    usernameReserved: "This username is reserved.",
    usernameTaken: "This username is already taken.",
    tooManyAttempts: "Too many sign-in attempts. Please try again later.",
    verificationInvalid: "The confirmation link is invalid or has expired",
    recoveryGeneric: "If this e-mail is registered, further instructions have been sent.",
    resetInvalid: "The new password could not be saved. Check the link and password requirements.",
  },
};

export function normalizeLocale(value) {
  const locale = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return supportedLocales.has(locale) ? locale : "ru";
}

export function requestLocale(request) {
  const bodyLocale = request.body?.locale;
  if (supportedLocales.has(bodyLocale)) return bodyLocale;
  const cookie = String(request.headers?.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("bookmeet_locale="));
  if (cookie) return normalizeLocale(decodeURIComponent(cookie.slice("bookmeet_locale=".length)));
  return normalizeLocale(request.headers?.["x-bookmeet-locale"] || request.headers?.["accept-language"]);
}

export function authText(locale, key, params = {}) {
  return authMessages[normalizeLocale(locale)][key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
