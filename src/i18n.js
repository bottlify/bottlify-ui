/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useEffect, useMemo } from "react";
import { sizeText } from "./engine/stored.js";
import { LANGUAGES } from "./settings.js";
import { useSettings } from "./useSettings.js";

/*
 * Every word the launcher says to a player, in Russian and in English, by one
 * key. A `{name}` in a text is filled from what the caller gives. The engine's
 * own panels for developers speak English only: they name the engine's parts.
 */

/** @type {Record<"ru" | "en", Record<string, string>>} */
export const STRINGS = {
  ru: {
    "button.back": "Назад",
    "button.cancel": "Отмена",
    "button.close": "Закрыть",
    "button.delete": "Удалить",
    "button.install": "Установить",
    "button.open": "Открыть",
    "button.play": "Играть",
    "button.rate": "Оценить",
    "button.save": "Сохранить",
    "button.settings": "Настройки",

    "header.home": "Bottlify, на главную",
    "header.search": "Найти игру",
    "header.language": "Язык интерфейса",
    "header.settings": "Настройки",

    "footer.credits": "Авторы и лицензии",
    "footer.docs": "Документация",
    "footer.source": "Исходный код",

    "home.title": "Оригинальные Windows игры,",
    "home.titleMuted": "во вкладке браузера.",
    "home.subtitle": "На компьютер ничего ставить не нужно, и картинка не транслируется с сервера. Игра "
      + "устанавливается в браузер, и её собственный код, тот же exe, с которым она вышла, работает на вашем "
      + "компьютере, внутри страницы.",
    "home.open": "Открыть библиотеку",
    "home.devTitle": "Идёт разработка",
    "home.devText": "Bottlify в активной разработке. Многие игры пока не запускаются: всё, что работает, идёт "
      + "через заново написанные Windows и DirectX, и они дописываются функция за функцией. Игра может "
      + "остановиться, нарисовать не то или замолчать. Такое исправляется в движке, а не обходится.",

    "app.noWebgpu": "Bottlify рисует игры через WebGPU, а в этом браузере его нет, поэтому игры здесь не "
      + "запустятся. Откройте Bottlify в свежем Chrome или Edge с включённым аппаратным ускорением.",
    "app.libraryFailed": "Не удалось загрузить библиотеку. Обновите страницу. ({reason})",
    "app.notFound": "Такой игры нет в библиотеке.",
    "app.backToLibrary": "В библиотеку",

    "status.works": "Работает",
    "status.issues": "Работает с проблемами",
    "status.fails": "Пока не запускается",
    "status.unknown": "Не проверялась",

    "library.mine": "Мои игры",
    "library.own": "Своя игра",
    "library.ownText": "Установщик, образ диска, архив или папка",
    "library.noMatch": "Среди ваших игр такой нет.",
    "library.freeIn": "Бесплатно в {store}",
    "library.freeNote": "Демо и бесплатные игры. Для установки нужен вход в {store}.",
    "library.inStore": "Ваши игры в {store}",
    "library.syncing": "Обновляем список…",
    "library.demo": "Демо",
    "library.free": "Бесплатная",
    "library.installing": "Устанавливается…",
    "library.installingShare": "Устанавливается, {share}%",

    "sheet.own": "Своя игра",
    "sheet.catalog": "Из библиотеки Bottlify",
    "sheet.fromStore": "Из {store}",
    "sheet.inBrowser": "в браузере",
    "sheet.ofInBrowser": "из {total} в браузере",
    "sheet.notDownloaded": "Ещё не скачана",
    "sheet.freeIn": "Бесплатная игра, {store}",
    "sheet.demoIn": "Демо, {store}",
    "sheet.inStore": "Ваша игра в {store}",
    "sheet.toInstall": "при установке",
    "sheet.mayNotFit": "Может не поместиться: скачать осталось {missing}, а свободно {free}.",
    "sheet.how": "Как работает в браузере",
    "sheet.how.works": "Идёт без замечаний.",
    "sheet.how.issues": "Играть можно, но что-то работает не так, как на Windows. Исправляем.",
    "sheet.how.fails": "Пока не доходит до игры. Исправляем.",
    "sheet.about": "Об игре",
    "sheet.saves": "Сохранения",
    "sheet.none": "нет",
    "sheet.lastRun": "Последний запуск",
    "sheet.neverRun": "Ещё не запускалась",
    "sheet.installFailed": "Не удалось установить: {reason}",
    "sheet.removeTitle": "Удалить {name}?",
    "sheet.removeLocal": "Игра, её сохранения и всё, что браузер хранит о ней, будут удалены. Вернуть их будет "
      + "нельзя.",
    "sheet.removeServer": "Скачанные данные и сохранения будут удалены из браузера. Игра останется в "
      + "библиотеке и при запуске скачается снова.",

    "gameSettings.own": "Своя игра",
    "gameSettings.developer": "Режим разработчика: ручные настройки игры",
    "gameSettings.tab.card": "Карточка",
    "gameSettings.tab.launch": "Запуск",
    "gameSettings.tab.system": "Система",
    "gameSettings.tab.graphics": "Графика",
    "gameSettings.tab.controls": "Управление",
    "gameSettings.tab.files": "Файлы",
    "gameSettings.name": "Название",
    "gameSettings.description": "Описание",
    "gameSettings.descriptionHint": "Пара строк об игре: их увидите только вы",
    "gameSettings.cover": "Обложка",
    "gameSettings.coverHelp": "Вертикальная картинка 2 : 3, например 600 × 900.",
    "gameSettings.coverOwn": "Своя обложка",
    "gameSettings.coverNone": "Своей обложки нет, показана буква названия",
    "gameSettings.pick": "Выбрать картинку",
    "gameSettings.wallpaper": "Широкая картинка",
    "gameSettings.status": "Как работает",
    "gameSettings.catalog": "В каталоге",
    "gameSettings.version": "Версия",
    "gameSettings.server": "На сервере",
    "gameSettings.serverHelp": "Игра пропадёт из библиотеки у всех, кто её открывает.",
    "gameSettings.deleteFromServer": "Удалить с сервера",
    "gameSettings.deleteFromServerTitle": "Удалить {name} с сервера?",
    "gameSettings.deleteFromServerText": "Игра пропадёт из библиотеки у всех. Вернуть её будет нельзя. "
      + "Сохранения в этом браузере останутся.",
    "gameSettings.program": "Программа",
    "gameSettings.programHelp": "Путь к exe внутри папки игры. Пусто: та, что выбрана при установке.",
    "gameSettings.args": "Параметры запуска",
    "gameSettings.argsHelp": "Нужны редко. Оставьте пустым, если игра не просит.",
    "gameSettings.argsHint": "Например, -windowed",
    "gameSettings.build": "Версия игры",
    "gameSettings.buildHelp": "Если у игры есть обе, 32-битная работает быстрее.",
    "gameSettings.build32": "32-bit, если есть",
    "gameSettings.auto": "Автоматически",
    "gameSettings.windowsHelp": "Автоматически: та Windows, для которой сделана игра.",
    "gameSettings.memory": "Память",
    "gameSettings.memoryHelp32": "32-битной игре Windows даёт не больше 2 ГБ. Тратится только то, что игра "
      + "занимает.",
    "gameSettings.memoryHelp64": "Больше 4 ГБ работает медленнее, поэтому даётся, только когда игре не хватает.",
    "gameSettings.cores": "Ядра процессора",
    "gameSettings.coresHelp": "Одно ядро медленнее, но некоторым старым играм так спокойнее.",
    "gameSettings.coresMany": "Несколько",
    "gameSettings.coresOne": "Одно",
    "gameSettings.directxHelp": "Какие версии DirectX есть у игры. Автоматически: все.",
    "gameSettings.card": "Видеокарта",
    "gameSettings.cardHelp": "Какую видеокарту видит игра: по ней она выбирает эффекты.",
    "gameSettings.cardHost": "Как у этого компьютера",
    "gameSettings.touchNote": "Управление на телефоне или планшете: кнопки и стик поверх игры.",
    "gameSettings.touch": "Управление",
    "gameSettings.stickKeys": "Клавиши стика",
    "gameSettings.stickHand": "Стик под",
    "gameSettings.size": "Размер",
    "gameSettings.folder": "Папка игры",
    "gameSettings.folderHelp": "Файлы игры, как их видит сама игра. Можно поправить настройки или добавить свои.",
    "gameSettings.export": "Копия игры",
    "gameSettings.exportHelp": "Вся игра одним файлом .btl: на случай, если браузер очистит данные сайта, или "
      + "чтобы перенести её в другой браузер.",
    "gameSettings.exportAction": "Скачать копию",
    "gameSettings.notExported": "Копия не сохранена: {reason}",

    "touch.keys": "Клавиши",
    "touch.mouse": "Мышь",
    "touch.pad": "Геймпад",
    "touch.off": "Выключено",
    "touch.arrows": "Стрелки",
    "touch.leftThumb": "Левый палец",
    "touch.rightThumb": "Правый палец",
    "touch.small": "Маленький",
    "touch.medium": "Средний",
    "touch.large": "Большой",
    "touch.fire": "Огонь",
    "touch.jump": "Прыжок",
    "touch.crouch": "Присесть",
    "touch.next": "Дальше",
    "touch.hide": "Скрыть",
    "touch.show": "Показать",
    "touch.keyboard": "Клавиатура",
    "touch.cursor": "Курсор",
    "touch.cursorGame": "Как в игре",
    "touch.cursorAlways": "Всегда",
    "touch.opacity": "Прозрачность",
    "touch.done": "Готово",

    "settings.general": "Общие",
    "settings.storage": "Место в браузере",
    "settings.accounts": "Аккаунты",
    "settings.whenHidden": "Когда вкладка не видна",
    "settings.pause": "Ставить игру на паузу",
    "settings.pauseText": "Игра не тратит батарею, пока вы в другой вкладке.",
    "settings.mute": "Выключать звук",
    "settings.developers": "Для разработчиков",
    "settings.developer": "Режим разработчика",
    "settings.developerText": "Журнал движка, счётчик кадров и ручные настройки любой игры.",
    "settings.engine": "Настройки движка и журнал",

    "storage.used": "Занято {used} из {quota}",
    "storage.unknown": "Браузер не сообщает, сколько места занято",
    "storage.quotaNote": "{quota} браузер выделяет этому сайту. Игры и сохранения хранятся только здесь.",
    "storage.onlyHere": "Игры и сохранения хранятся только в этом браузере.",
    "storage.notKept": "Если на диске кончится место, браузер может очистить их.",
    "storage.games": "Игры",
    "storage.empty": "В браузере пока ничего не хранится.",
    "storage.sizeWithSaves": "{size}, из них сохранения {saves}",
    "storage.running": "запущена",
    "storage.unreadable": "Не удалось узнать, что хранится в браузере: {reason}",
    "storage.removeTitle": "Удалить {name} из браузера?",
    "storage.removeText": "Всё, что браузер хранит об этой игре, будет удалено: скачанные данные, "
      + "сохранения и ваши изменения в её файлах. Вернуть это будет нельзя.",
    "storage.clearCache": "Очистить кэш",
    "storage.cacheTitle": "Очистить кэш {name}?",
    "storage.cacheText": "Скачанные данные и кэш будут удалены, следующий запуск будет дольше. Сохранения "
      + "останутся.",
    "storage.deleteSaves": "Удалить сохранения",
    "storage.savesTitle": "Удалить сохранения {name}?",
    "storage.savesText": "Всё, что игра записала в браузере, сохранения и её настройки, будет удалено "
      + "навсегда.",
    "storage.clearAll": "Очистить все кэши",
    "storage.allTitle": "Очистить кэши всех игр?",
    "storage.allText": "Скачанные данные и кэш всех игр будут удалены, каждая скачает их снова при запуске. "
      + "Сохранения останутся.",
    "storage.skipped": "Запущены, поэтому не тронуты: {names}.",
    "storage.failed": "Не удалось очистить: {names}.",
    "storage.overwrite": "Освобождать место за счёт других игр",
    "storage.overwriteText": "Когда место кончается, игра сначала удаляет свои давние данные, а потом, если "
      + "включено, скачанные данные других игр, самые старые первыми. Сохранения не трогаются.",

    "accounts.signIn": "Войти в {store}",
    "accounts.signOut": "Выйти",
    "accounts.sync": "Обновить список игр",
    "accounts.syncing": "Обновляем…",
    "accounts.signedInAs": "Вы вошли как {name}.",
    "accounts.connecting": "Подключаемся…",
    "accounts.why": "Вход нужен, чтобы устанавливать игры из вашей библиотеки {store}.",
    "accounts.needExtension": "Для входа нужно расширение Bottlify GameHub в этом браузере. Установите его и "
      + "обновите страницу.",
    "accounts.getGameHub": "Установить GameHub",
    "accounts.error": "{store} ответил ошибкой: {reason}",
    "accounts.signInTo": "Вход в {store}",
    "accounts.windowOpened": "Открылось окно {store}: войдите там. Оно закроется само, когда вы войдёте.",
    "accounts.updateGameHub": "Эта версия расширения Bottlify GameHub не умеет входить здесь. Обновите его.",
    "accounts.kept": "Вход выполняет расширение Bottlify GameHub: пароль и сессия остаются в нём, эта страница "
      + "их не видит.",
    "accounts.needSignIn": "Чтобы играть, войдите в {store}",
    "accounts.needGameHub": "Эта игра устанавливается из вашего аккаунта {store}. Добавьте в браузер "
      + "расширение Bottlify GameHub, обновите страницу и войдите в {store}.",

    "add.title": "Добавить свою игру",
    "add.subtitle": "Игра будет храниться только в этом браузере. Мы её никуда не загружаем.",
    "add.step.file": "Файл",
    "add.step.install": "Установка",
    "add.step.name": "Название",
    "add.drop": "Перетащите игру сюда",
    "add.choose": "Выбрать файл",
    "add.kind.installer": "Установщик",
    "add.kind.disc": "Образ диска",
    "add.kind.archive": "Архив",
    "add.kind.bottle": "Бутылка",
    "add.kindText.installer": "setup.exe установится, как на компьютере",
    "add.kindText.disc": ".iso, как вставленный диск",
    "add.kindText.archive": ".zip с игрой или установщиком",
    "add.kindText.bottle": ".btl, сохранённая в Bottlify",
    "add.unsupported": "{name}: такой файл не подходит. Подойдёт установщик (.exe), архив .zip, образ диска "
      + "(.iso) или бутылка (.btl).",
    "add.not-a-pc-disc": "{name} не похож на диск для компьютера: на нём нет файловой системы ISO 9660. "
      + "Возможно, это диск от игровой приставки.",
    "add.unreadable": "Не удалось прочитать {name}: {reason}",
    "add.noRoom": "{name} занимает {size}, а свободно в браузере {free}. Для установки места не хватит.",
    "add.checking": "Проверяем файл, {size}",
    "add.reading": "Читаем файл: {done} из {total}",
    "add.unpacking": "Распаковываем: {done} из {total} файлов",
    "add.machine": "Windows",
    "add.machineHelp": "Почти всем играм подходит 32-bit. Изменить это после установки нельзя.",
    "add.wizardNote": "Откроется установщик игры. Если он задаёт вопросы, отвечайте в его окне.",
    "add.install": "Установить",
    "add.installedAlready": "Это уже установленная игра",
    "add.installingTitle": "Установка {name}",
    "add.program": "Программа для запуска",
    "add.programChoose": "Выберите .exe или .msi, с которого начать",
    "add.programHelp": "Нашли в папке игры. Изменить можно потом в настройках игры.",
    "add.name": "Название",
    "add.replaces": "Игра с таким названием уже есть в библиотеке. Новая заменит её, сохранения останутся.",
    "add.nothingToStart": "Установщик не оставил программы, которую можно запустить.",
    "add.keepArchiveNote": "Если в архиве уже установленная игра, добавьте его файлы.",
    "add.keepArchive": "Добавить файлы архива",
    "add.saving": "Сохраняем игру в браузере…",
    "add.add": "Добавить в библиотеку",
    "add.added": "{name} в библиотеке",
    "add.putAside": "Установка закончена, но игра ещё не добавлена.",
    "add.finish": "Добавить в библиотеку",

    "download.title": "Игра ещё не скачана",
    "download.part": "Ещё {missing} из {name} нет на этом устройстве.",
    "download.whole": "{name} ещё нет на этом устройстве ({size}).",
    "download.why": "Если играть сразу, игра будет догружаться и может подтормаживать. Скачайте её заранее, "
      + "чтобы играть без задержек.",
    "download.playAnyway": "Играть сразу",
    "download.download": "Скачать",

    "play.untitled": "Игра",
    "play.volume": "Звук",
    "play.mute": "Выключить звук",
    "play.unmute": "Включить звук",
    "play.fullscreen": "Во весь экран",
    "play.menu": "Меню",
    "play.controls": "Управление",
    "play.rate": "Оценить, как работает",
    "play.close": "Закрыть игру",
    "play.showBar": "Показать панель",
    "play.pressToStart": "Нажмите, чтобы начать",
    "play.stage.fetch": "Загружаем игру",
    "play.stage.init": "Готовим запуск",
    "play.stage.loading": "Игра запускается",
    "play.stage.installing": "Идёт установка",
    "play.loadingData": "Догружаем данные игры…",
    "play.turn": "Поверните телефон",
    "play.turnText": "Игра рассчитана на экран, повёрнутый горизонтально.",
    "play.cutOff": "В прошлый раз браузер закрыл страницу, пока игра запускалась.",
    "play.fullscreenHint": "Чтобы выйти из полноэкранного режима, нажмите и подержите Esc.",
    "play.homeScreenHint": "В этом браузере нет полноэкранного режима для игр. Добавьте Bottlify на экран "
      + "«Домой» (Поделиться, затем На экран «Домой») и откройте оттуда.",
    "play.captured": "Мышь захвачена игрой. Чтобы освободить её, держите правый Alt (правый Option на Mac).",
    "play.storageFull": "В браузере кончилось место. Игра работает дальше, но новые данные не сохраняются. "
      + "Освободите место в настройках, раздел «Место в браузере».",
    "play.programSays": "Сообщение игры",
    "play.dotnet": "Устанавливаем .NET Framework",
    "play.dotnetText": "Он нужен этой игре, а в браузере его ещё нет. Устанавливается один раз для всех игр, "
      + "которым он нужен, и это занимает время.",
    "play.build.download": "Скачиваем установщик",
    "play.build.install": "Устанавливаем",
    "play.build.then": "Готовим к быстрому запуску",
    "play.build.pack": "Сохраняем в браузере",
    "play.crashed": "Игра остановилась из-за ошибки",
    "play.closedTitle": "{name} закрылась",
    "play.stoppedTitle": "{name} остановлена",
    "play.crashedText": "Сохранения на месте. Попробуйте запустить ещё раз. Если повторяется, отправьте отчёт: "
      + "в нём видно, где игра остановилась.",
    "play.closedText": "Сохранения на месте. Можно запустить игру снова или вернуться в библиотеку.",
    "play.again": "Запустить снова",
    "play.toLibrary": "В библиотеку",
    "play.help.mouse": "Щёлкните по игре, и мышь перейдёт к ней: курсор браузера скроется, если игра рисует "
      + "свой.",
    "play.help.release": "Чтобы освободить мышь, держите правый Alt (правый Option на Mac).",
    "play.help.fullscreen": "Во весь экран: кнопка на панели сверху.",
    "play.help.leave": "Выйти из полноэкранного режима: нажмите и подержите Esc. Короткое нажатие Esc "
      + "получает игра.",
    "play.help.touch": "Стик слева двигает, кнопки справа стреляют и прыгают, касание по игре щёлкает. "
      + "Шестерёнка в углу настраивает управление.",

    "rate.title": "Как работает {name}?",
    "rate.subtitle": "Оценку увидят другие игроки на странице игры.",
    "rate.works": "Работает",
    "rate.worksText": "Играл как обычно, без заметных проблем",
    "rate.issues": "Работает с проблемами",
    "rate.issuesText": "Играть можно, но что-то мешает",
    "rate.fails": "Не запускается",
    "rate.failsText": "Не дошёл до меню или игра закрывается",
    "rate.comment": "Что мешает",
    "rate.commentHint": "Например: мигает изображение в роликах",
    "rate.send": "Отправить оценку",
    "report.title": "Отправить отчёт",
    "report.subtitle": "По отчёту мы находим и исправляем причину.",
    "report.what": "Что вы делали",
    "report.whatHint": "Например: открыл карту, через минуту игра закрылась",
    "report.optional": "Необязательно, но помогает.",
    "report.contents": "В отчёте: игра и откуда она ({name}, {store}), версия браузера, как остановилась игра "
      + "и журнал движка за последние минуты. Без аккаунтов, файлов игры и сохранений.",
    "report.send": "Отправить отчёт",
    "feedback.unsent": "Пока не отправлено: приём оценок и отчётов ещё не работает.",

    "files.title": "Файлы: {name}",
    "files.folderName": "Название папки",
    "files.newFolder": "Новая папка",
    "files.addFiles": "Добавить файлы",
    "files.addFolder": "Добавить папку",
    "files.reading": "Читаем…",
    "files.empty": "Пусто.",
    "files.home": "Папка игры",
    "files.download": "Скачать",
    "files.edit": "Изменить",
    "files.replace": "Заменить",
    "files.restore": "Вернуть",
    "files.restoreOwn": "Вернуть как было в игре",
    "files.badName": "«{name}» не годится для названия папки",
    "files.state.saved": "записан игрой",
    "files.state.changed": "изменён",
    "files.state.added": "добавлен",
    "files.state.deleted": "удалён",

    "license.title": "Авторы и лицензии",
    "license.own": "Исходный код Bottlify открыт по лицензии",
    "license.others": "Он стоит на работе других людей, и здесь сказано, на чьей.",
    "license.launcher": "Шрифты и значки",
    "license.text": "текст лицензии",
    "license.engine": "Движок",
    "license.games": "Игры, обложки и бутылки",
    "license.gamesText": "Игры в библиотеке, их обложки и описания принадлежат их авторам и правообладателям. "
      + "В библиотеке только демоверсии, которые правообладатели сами распространяли бесплатно, и у каждой "
      + "указаны год и правообладатель. Bottlify не претендует на права на них и ничего не продаёт.",
    "license.takedown": "Если у вас есть права на что-то здесь и этого здесь быть не должно, напишите на",
    "license.takedownEnd": ", и мы это уберём.",
  },
  en: {
    "button.back": "Back",
    "button.cancel": "Cancel",
    "button.close": "Close",
    "button.delete": "Delete",
    "button.install": "Install",
    "button.open": "Open",
    "button.play": "Play",
    "button.rate": "Rate",
    "button.save": "Save",
    "button.settings": "Settings",

    "header.home": "Bottlify, home",
    "header.search": "Find a game",
    "header.language": "Interface language",
    "header.settings": "Settings",

    "footer.credits": "Credits and licenses",
    "footer.docs": "Documentation",
    "footer.source": "Source code",

    "home.title": "Original Windows games,",
    "home.titleMuted": "in a browser tab.",
    "home.subtitle": "Nothing to install on your computer, and no picture streamed from a server. The game "
      + "installs into the browser, and its own code, the same x86 executable it shipped with, runs on your "
      + "machine, inside the page.",
    "home.open": "Open the library",
    "home.devTitle": "Under construction",
    "home.devText": "Bottlify is in active development. Many games do not run yet: everything that does runs "
      + "through Windows and DirectX written anew, one function at a time. A game may stop, draw the wrong "
      + "thing or go quiet. That is fixed in the engine, not worked around.",

    "app.noWebgpu": "Bottlify draws games through WebGPU, which this browser does not have, so no game will "
      + "start here. Open Bottlify in a current Chrome or Edge with hardware acceleration on.",
    "app.libraryFailed": "The library could not be loaded. Reload the page. ({reason})",
    "app.notFound": "There is no such game in the library.",
    "app.backToLibrary": "Back to the library",

    "status.works": "Works",
    "status.issues": "Works with issues",
    "status.fails": "Does not start yet",
    "status.unknown": "Not checked",

    "library.mine": "My games",
    "library.own": "Your own game",
    "library.ownText": "An installer, a disc image, an archive or a folder",
    "library.noMatch": "None of your games is called that.",
    "library.freeIn": "Free on {store}",
    "library.freeNote": "Demos and free games. Installing them needs a {store} sign-in.",
    "library.inStore": "Your games on {store}",
    "library.syncing": "Updating the list…",
    "library.demo": "Demo",
    "library.free": "Free",
    "library.installing": "Installing…",
    "library.installingShare": "Installing, {share}%",

    "sheet.own": "Your own game",
    "sheet.catalog": "From the Bottlify library",
    "sheet.fromStore": "From {store}",
    "sheet.inBrowser": "in the browser",
    "sheet.ofInBrowser": "of {total} in the browser",
    "sheet.notDownloaded": "Not downloaded yet",
    "sheet.freeIn": "Free game, {store}",
    "sheet.demoIn": "Demo, {store}",
    "sheet.inStore": "Your game on {store}",
    "sheet.toInstall": "to install",
    "sheet.mayNotFit": "May not fit: {missing} still to download, {free} free.",
    "sheet.how": "How it runs in the browser",
    "sheet.how.works": "Runs without issues.",
    "sheet.how.issues": "Playable, but something does not work as it does on Windows. Being fixed.",
    "sheet.how.fails": "Does not reach the game yet. Being fixed.",
    "sheet.about": "About the game",
    "sheet.saves": "Saves",
    "sheet.none": "none",
    "sheet.lastRun": "Last played",
    "sheet.neverRun": "Not played yet",
    "sheet.installFailed": "Could not install: {reason}",
    "sheet.removeTitle": "Delete {name}?",
    "sheet.removeLocal": "The game, its saves and everything the browser keeps of it are deleted. None of it "
      + "can be brought back.",
    "sheet.removeServer": "Its downloaded data and saves are deleted from the browser. The game stays in the "
      + "library and downloads again when you play it.",

    "gameSettings.own": "Your own game",
    "gameSettings.developer": "Developer mode: this game's own settings",
    "gameSettings.tab.card": "Card",
    "gameSettings.tab.launch": "Launch",
    "gameSettings.tab.system": "System",
    "gameSettings.tab.graphics": "Graphics",
    "gameSettings.tab.controls": "Controls",
    "gameSettings.tab.files": "Files",
    "gameSettings.name": "Name",
    "gameSettings.description": "Description",
    "gameSettings.descriptionHint": "A line or two about the game: only you see it",
    "gameSettings.cover": "Cover",
    "gameSettings.coverHelp": "A portrait picture at 2 : 3, such as 600 × 900.",
    "gameSettings.coverOwn": "A cover of its own",
    "gameSettings.coverNone": "No cover of its own: the name's first letter is shown",
    "gameSettings.pick": "Choose a picture",
    "gameSettings.wallpaper": "Wide picture",
    "gameSettings.status": "How it runs",
    "gameSettings.catalog": "In the catalog",
    "gameSettings.version": "Version",
    "gameSettings.server": "On the server",
    "gameSettings.serverHelp": "The game leaves the library for everyone who opens it.",
    "gameSettings.deleteFromServer": "Delete from the server",
    "gameSettings.deleteFromServerTitle": "Delete {name} from the server?",
    "gameSettings.deleteFromServerText": "The game leaves the library for everyone and cannot be brought back. "
      + "The saves in this browser stay.",
    "gameSettings.program": "Program",
    "gameSettings.programHelp": "The path to the exe inside the game's folder. Empty: the one chosen at install.",
    "gameSettings.args": "Launch options",
    "gameSettings.argsHelp": "Rarely needed. Leave it empty unless the game asks for one.",
    "gameSettings.argsHint": "Such as -windowed",
    "gameSettings.build": "Game build",
    "gameSettings.buildHelp": "Where a game ships both, the 32-bit one runs faster.",
    "gameSettings.build32": "32-bit where it has one",
    "gameSettings.auto": "Automatic",
    "gameSettings.windowsHelp": "Automatic: the Windows the game was made for.",
    "gameSettings.memory": "Memory",
    "gameSettings.memoryHelp32": "Windows gives a 32-bit game at most 2 GB. Only what the game uses costs "
      + "anything.",
    "gameSettings.memoryHelp64": "More than 4 GB runs slower, so it is given only when a game runs short.",
    "gameSettings.cores": "Processor cores",
    "gameSettings.coresHelp": "One core is slower, but some old games are steadier on it.",
    "gameSettings.coresMany": "Several",
    "gameSettings.coresOne": "One",
    "gameSettings.directxHelp": "Which versions of DirectX the game has. Automatic: all of them.",
    "gameSettings.card": "Video card",
    "gameSettings.cardHelp": "The video card the game is told of: it picks its effects by it.",
    "gameSettings.cardHost": "As this computer's",
    "gameSettings.touchNote": "Controls on a phone or a tablet: buttons and a stick over the game.",
    "gameSettings.touch": "Controls",
    "gameSettings.stickKeys": "Stick keys",
    "gameSettings.stickHand": "Stick under",
    "gameSettings.size": "Size",
    "gameSettings.folder": "Game folder",
    "gameSettings.folderHelp": "The game's files as the game sees them. Edit its settings or add your own.",
    "gameSettings.export": "A copy of the game",
    "gameSettings.exportHelp": "The whole game as one .btl file: in case the browser clears the site's data, or "
      + "to move it to another browser.",
    "gameSettings.exportAction": "Download a copy",
    "gameSettings.notExported": "The copy was not saved: {reason}",

    "touch.keys": "Keys",
    "touch.mouse": "Mouse",
    "touch.pad": "Gamepad",
    "touch.off": "Off",
    "touch.arrows": "Arrows",
    "touch.leftThumb": "Left thumb",
    "touch.rightThumb": "Right thumb",
    "touch.small": "Small",
    "touch.medium": "Medium",
    "touch.large": "Large",
    "touch.fire": "Fire",
    "touch.jump": "Jump",
    "touch.crouch": "Crouch",
    "touch.next": "Next",
    "touch.hide": "Hide",
    "touch.show": "Show",
    "touch.keyboard": "Keyboard",
    "touch.cursor": "Cursor",
    "touch.cursorGame": "The game's",
    "touch.cursorAlways": "Always",
    "touch.opacity": "Opacity",
    "touch.done": "Done",

    "settings.general": "General",
    "settings.storage": "Space in the browser",
    "settings.accounts": "Accounts",
    "settings.whenHidden": "When the tab is hidden",
    "settings.pause": "Pause the game",
    "settings.pauseText": "The game spends no battery while you are in another tab.",
    "settings.mute": "Mute the sound",
    "settings.developers": "For developers",
    "settings.developer": "Developer mode",
    "settings.developerText": "The engine's journal, the frame counter and any game's own settings.",
    "settings.engine": "Engine settings and journal",

    "storage.used": "{used} of {quota} used",
    "storage.unknown": "The browser does not say how much space is used",
    "storage.quotaNote": "The browser gives this site {quota}. Games and saves are kept here only.",
    "storage.onlyHere": "Games and saves are kept in this browser only.",
    "storage.notKept": "If the disk runs low, the browser may clear them.",
    "storage.games": "Games",
    "storage.empty": "Nothing is kept in this browser yet.",
    "storage.sizeWithSaves": "{size}, of it saves {saves}",
    "storage.running": "running",
    "storage.unreadable": "What this browser keeps could not be read: {reason}",
    "storage.removeTitle": "Delete {name} from the browser?",
    "storage.removeText": "Everything the browser keeps of this game is deleted: its downloaded data, its saves "
      + "and your changes to its files. None of it can be brought back.",
    "storage.clearCache": "Clear cache",
    "storage.cacheTitle": "Clear the cache of {name}?",
    "storage.cacheText": "Its downloaded data and cache are deleted, and its next start is slower. Saves stay.",
    "storage.deleteSaves": "Delete saves",
    "storage.savesTitle": "Delete the saves of {name}?",
    "storage.savesText": "Everything the game wrote in this browser, its saves and its settings, is deleted "
      + "for good.",
    "storage.clearAll": "Clear every cache",
    "storage.allTitle": "Clear every game's cache?",
    "storage.allText": "Every game's downloaded data and cache are deleted; each downloads them again at its "
      + "next start. Saves stay.",
    "storage.skipped": "Running, so left as they are: {names}.",
    "storage.failed": "Could not be cleared: {names}.",
    "storage.overwrite": "Make room from other games",
    "storage.overwriteText": "When space runs out, a game first frees its own old data, then, if this is on, "
      + "other games' downloaded data, the oldest first. Saves are never touched.",

    "accounts.signIn": "Sign in to {store}",
    "accounts.signOut": "Sign out",
    "accounts.sync": "Update the game list",
    "accounts.syncing": "Updating…",
    "accounts.signedInAs": "Signed in as {name}.",
    "accounts.connecting": "Connecting…",
    "accounts.why": "Sign in to install games from your {store} library.",
    "accounts.needExtension": "Signing in needs the Bottlify GameHub extension in this browser. Add it, then "
      + "reload the page.",
    "accounts.getGameHub": "Get GameHub",
    "accounts.error": "{store} answered with an error: {reason}",
    "accounts.signInTo": "Sign in to {store}",
    "accounts.windowOpened": "A {store} window has opened: sign in there. It closes once you are signed in.",
    "accounts.updateGameHub": "This version of the Bottlify GameHub extension cannot sign in here. Update it.",
    "accounts.kept": "The Bottlify GameHub extension does the sign-in: your password and the session stay in "
      + "it, out of this page's reach.",
    "accounts.needSignIn": "Sign in to {store} to play",
    "accounts.needGameHub": "This game is installed from your {store} account. Add the Bottlify GameHub "
      + "extension to this browser, reload the page and sign in to {store}.",

    "add.title": "Add your own game",
    "add.subtitle": "The game is kept in this browser only. We never upload it anywhere.",
    "add.step.file": "File",
    "add.step.install": "Install",
    "add.step.name": "Name",
    "add.drop": "Drop the game here",
    "add.choose": "Choose a file",
    "add.kind.installer": "Installer",
    "add.kind.disc": "Disc image",
    "add.kind.archive": "Archive",
    "add.kind.bottle": "Bottle",
    "add.kindText.installer": "setup.exe installs as on a computer",
    "add.kindText.disc": ".iso, as a disc in the drive",
    "add.kindText.archive": ".zip with a game or its installer",
    "add.kindText.bottle": ".btl saved from Bottlify",
    "add.unsupported": "{name}: this kind of file is not taken. An installer (.exe), a .zip, a disc image "
      + "(.iso) or a bottle (.btl) is.",
    "add.not-a-pc-disc": "{name} is not a disc for a computer: it has no ISO 9660 file system. It may be a game "
      + "console's disc.",
    "add.unreadable": "{name} could not be read: {reason}",
    "add.noRoom": "{name} is {size} and the browser has {free} free: not enough to install it.",
    "add.checking": "Checking the file, {size}",
    "add.reading": "Reading the file: {done} of {total}",
    "add.unpacking": "Unpacking: {done} of {total} files",
    "add.machine": "Windows",
    "add.machineHelp": "32-bit suits almost every game. It cannot be changed after the install.",
    "add.wizardNote": "The game's installer opens next. If it asks anything, answer in its window.",
    "add.install": "Install",
    "add.installedAlready": "It is installed already",
    "add.installingTitle": "Installing {name}",
    "add.program": "Program to start",
    "add.programChoose": "Choose the .exe or .msi to start with",
    "add.programHelp": "Found in the game's folder. You can change it later in the game's settings.",
    "add.name": "Name",
    "add.replaces": "A game of this name is in the library already. The new one replaces it; the saves stay.",
    "add.nothingToStart": "The installer left no program to start.",
    "add.keepArchiveNote": "If the archive holds the game already installed, add its files.",
    "add.keepArchive": "Add the archive's files",
    "add.saving": "Saving the game in the browser…",
    "add.add": "Add to the library",
    "add.added": "{name} is in the library",
    "add.putAside": "The install is done, but the game is not added yet.",
    "add.finish": "Add to the library",

    "download.title": "Not downloaded yet",
    "download.part": "{missing} of {name} is not on this device yet.",
    "download.whole": "{name} is not on this device yet ({size}).",
    "download.why": "Played now, it loads as you play and may stutter while it waits. Download it first to play "
      + "without delays.",
    "download.playAnyway": "Play now",
    "download.download": "Download",

    "play.untitled": "Game",
    "play.volume": "Sound",
    "play.mute": "Mute",
    "play.unmute": "Unmute",
    "play.fullscreen": "Fullscreen",
    "play.menu": "Menu",
    "play.controls": "Controls",
    "play.rate": "Rate how it runs",
    "play.close": "Close the game",
    "play.showBar": "Show the bar",
    "play.pressToStart": "Press to start",
    "play.stage.fetch": "Loading the game",
    "play.stage.init": "Getting ready",
    "play.stage.loading": "The game is starting",
    "play.stage.installing": "Installing",
    "play.loadingData": "Loading game data…",
    "play.turn": "Turn your phone sideways",
    "play.turnText": "The game is drawn for a screen held in landscape.",
    "play.cutOff": "Last time the browser closed the page while the game was starting.",
    "play.fullscreenHint": "Press and hold Esc to leave fullscreen.",
    "play.homeScreenHint": "This browser has no fullscreen for a game. To play on the whole screen, add Bottlify "
      + "to the home screen (Share, then Add to Home Screen) and open it from there.",
    "play.captured": "The game has the mouse. Hold right Alt (right Option on a Mac) to free it.",
    "play.storageFull": "The browser is out of space. The game keeps running, but what it downloads now is not "
      + "kept. Free some in Settings, Space in the browser.",
    "play.programSays": "The game says",
    "play.dotnet": "Setting up the .NET Framework",
    "play.dotnetText": "This game needs it, and this browser does not have it yet. It is set up once, for every "
      + "game that needs it; that takes a while.",
    "play.build.download": "Downloading the setup",
    "play.build.install": "Installing",
    "play.build.then": "Preparing it to start fast",
    "play.build.pack": "Keeping it in this browser",
    "play.crashed": "The game stopped on an error",
    "play.closedTitle": "{name} closed",
    "play.stoppedTitle": "{name} stopped",
    "play.crashedText": "Your saves are where they were. Try starting it again. If it happens again, send a "
      + "report: it shows where the game stopped.",
    "play.closedText": "Your saves are where they were. Start the game again or go back to the library.",
    "play.again": "Start again",
    "play.toLibrary": "To the library",
    "play.help.mouse": "Click the game and the mouse is its: the browser's cursor hides where the game draws "
      + "its own.",
    "play.help.release": "To free the mouse, hold right Alt (right Option on a Mac).",
    "play.help.fullscreen": "Fullscreen: the button on the bar at the top.",
    "play.help.leave": "To leave fullscreen, press and hold Esc. A short press of Esc is the game's.",
    "play.help.touch": "The stick on the left moves, the buttons on the right fire and jump, a tap on the game "
      + "clicks. The gear in the corner sets the controls up.",

    "rate.title": "How does {name} run?",
    "rate.subtitle": "Other players see the rating on the game's page.",
    "rate.works": "Works",
    "rate.worksText": "Played as usual, with no issues to speak of",
    "rate.issues": "Works with issues",
    "rate.issuesText": "Playable, but something gets in the way",
    "rate.fails": "Does not start",
    "rate.failsText": "Did not reach the menu, or the game closes",
    "rate.comment": "What gets in the way",
    "rate.commentHint": "Such as: the picture flickers in the videos",
    "rate.send": "Send the rating",
    "report.title": "Send a report",
    "report.subtitle": "A report is how we find the cause and fix it.",
    "report.what": "What were you doing",
    "report.whatHint": "Such as: opened the map, a minute later the game closed",
    "report.optional": "Optional, but it helps.",
    "report.contents": "The report holds: the game and where it is from ({name}, {store}), the browser's "
      + "version, how the game stopped and the engine's journal of the last minutes. No accounts, no game "
      + "files, no saves.",
    "report.send": "Send the report",
    "feedback.unsent": "Not sent yet: ratings and reports are not received anywhere yet.",

    "files.title": "Files: {name}",
    "files.folderName": "Folder name",
    "files.newFolder": "New folder",
    "files.addFiles": "Add files",
    "files.addFolder": "Add folder",
    "files.reading": "Reading…",
    "files.empty": "Empty.",
    "files.home": "The game's folder",
    "files.download": "Download",
    "files.edit": "Edit",
    "files.replace": "Replace",
    "files.restore": "Restore",
    "files.restoreOwn": "Restore the game's own",
    "files.badName": "\"{name}\" is not a folder name",
    "files.state.saved": "saved by the game",
    "files.state.changed": "changed",
    "files.state.added": "added",
    "files.state.deleted": "deleted",

    "license.title": "Credits and licenses",
    "license.own": "Bottlify is open source under the",
    "license.others": "It stands on the work of others, and here is whose.",
    "license.launcher": "Typefaces and icons",
    "license.text": "licence text",
    "license.engine": "The engine",
    "license.games": "Games, covers and bottles",
    "license.gamesText": "The games in the library, their covers and their descriptions belong to their "
      + "original authors and rights holders. The library holds only demo versions that the rights holders "
      + "themselves distributed free of charge, and each entry names the year and the holder of the rights. "
      + "Bottlify claims no rights over them and sells nothing.",
    "license.takedown": "If you hold the rights to something here and it should not be here, write to",
    "license.takedownEnd": " and it will be taken down.",
  },
};

/**
 * The language the interface speaks: the one the switch chose, else the
 * browser's own where it is Russian, else English.
 *
 * @param {string} chosen  `settings.language`; empty until the switch is used.
 * @param {string | undefined} browser  `navigator.language`.
 * @returns {"ru" | "en"}
 */
export function languageOf(chosen, browser) {
  if (LANGUAGES.includes(chosen)) return /** @type {"ru" | "en"} */ (chosen);
  return /^ru\b/i.test(browser ?? "") ? "ru" : "en";
}

/**
 * A text by its key, its `{name}`s filled. A key one language lacks is said in
 * the other; one neither has is said as itself, so a gap shows rather than hides.
 *
 * @param {"ru" | "en"} lang
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 */
export function translate(lang, key, vars) {
  const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : text;
}

const UNITS = { ru: { B: "Б", KB: "КБ", MB: "МБ", GB: "ГБ", TB: "ТБ" } };

/**
 * Bytes as a person reads them in the language: `sizeText`'s figure, its units
 * and decimal mark the language's.
 *
 * @param {"ru" | "en"} lang
 * @param {number} bytes
 */
export function bytesIn(lang, bytes) {
  const text = sizeText(bytes);
  if (lang === "en") return text;
  return text.replace(".", ",").replace(/[KMGT]?B$/, (unit) => UNITS.ru[/** @type {"B"} */ (unit)]);
}

/**
 * A moment in the past as days from today: today, yesterday, three days ago.
 *
 * @param {"ru" | "en"} lang
 * @param {number} then  Milliseconds since the epoch.
 * @param {number} [now]
 */
export function whenIn(lang, then, now = Date.now()) {
  const day = (/** @type {number} */ at) => {
    const date = new Date(at);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  };
  const text = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(day(then) - day(now), "day");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * @typedef {((key: string, vars?: Record<string, unknown>) => string) & {
 *   lang: "ru" | "en", bytes: (bytes: number) => string, when: (then: number) => string }} Translator
 */

/**
 * The interface's words in the language it speaks now; a new function when the
 * language changes, so what depends on it follows.
 *
 * @returns {Translator}
 */
export function useT() {
  const { language } = useSettings();
  const lang = languageOf(language, globalThis.navigator?.language);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return useMemo(() => {
    const t = /** @type {Translator} */ ((key, vars) => translate(lang, key, vars));
    t.lang = lang;
    t.bytes = (bytes) => bytesIn(lang, bytes);
    t.when = (then) => whenIn(lang, then);
    return t;
  }, [lang]);
}
