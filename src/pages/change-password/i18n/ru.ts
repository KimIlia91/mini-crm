/** Texts of the forced password change page. Namespace: `change-password`. */
export const changePasswordRu = {
  title: 'Смена пароля',
  description: 'Это ваш первый вход. Задайте собственный пароль, чтобы продолжить.',
  newPassword: 'Новый пароль',
  confirmPassword: 'Повторите пароль',
  submit: 'Сменить пароль',
  validation: {
    minLength: 'Минимум 8 символов',
    lowercase: 'Добавьте строчную латинскую букву',
    uppercase: 'Добавьте заглавную латинскую букву',
    digit: 'Добавьте цифру',
    confirmRequired: 'Повторите пароль',
    mismatch: 'Пароли не совпадают',
  },
  errors: {
    samePassword: 'Новый пароль должен отличаться от текущего',
    weakPassword: 'Слишком простой пароль: минимум 8 символов, строчные и заглавные буквы и цифра',
    generic: 'Не удалось сменить пароль. Попробуйте ещё раз',
  },
} as const
