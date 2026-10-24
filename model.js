(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ThesisModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COURSE_VERSION = '2026-10-23';
  var MAX_NOTES = 20000;
  var MAX_ACTIVITY = 1000;
  var has = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  var forbidden = function (key) { return key === '__proto__' || key === 'prototype' || key === 'constructor'; };
  var fail = function (message) { throw new Error(message); };

  function plain(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '必须是普通对象。');
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(label + '包含不支持的对象类型。');
  }

  // Reject dangerous keys before copying even data received from JSON.parse.
  function safeTree(value, seen, depth) {
    if (depth > 30) fail('备份层级过深。');
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') fail('备份包含不支持的数据。');
      if (typeof value === 'number' && !Number.isFinite(value)) fail('备份包含无效数字。');
      return;
    }
    if (seen.indexOf(value) !== -1) fail('备份包含循环引用。');
    if (!Array.isArray(value)) plain(value, '备份字段');
    seen.push(value);
    Object.keys(value).forEach(function (key) {
      if (forbidden(key)) fail('备份包含不安全的字段。');
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) fail('备份包含不支持的字段。');
      safeTree(value[key], seen, depth + 1);
    });
    seen.pop();
  }

  function keysOnly(object, allowed, label) {
    Object.keys(object).forEach(function (key) {
      if (allowed.indexOf(key) === -1) fail(label + '包含未知字段：' + key);
    });
  }

  function id(value, label) {
    if (typeof value !== 'string' || !value || value.length > 160 || forbidden(value) || /[:\u0000-\u0020]/.test(value)) fail(label + '无效。');
    return value;
  }

  function note(value) {
    if (typeof value !== 'string' || value.length > MAX_NOTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('学习笔记必须是 20000 字符以内的文本。');
    return value;
  }

  function date(value, label, optional) {
    if ((value === null || value === undefined) && optional) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(label + '不是有效的 ISO 日期。');
    return new Date(value).toISOString();
  }

  function now(value) { return date(value === undefined ? new Date().toISOString() : value, '操作时间', false); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  function taskMap(taskList) {
    if (!Array.isArray(taskList)) fail('课程任务列表无效。');
    var map = new Map();
    taskList.forEach(function (task) {
      plain(task, '课程任务');
      id(task.id, '任务编号');
      if (map.has(task.id)) fail('课程中存在重复任务编号。');
      if (!Array.isArray(task.quiz) || !task.quiz.length) fail('任务必须包含自测题。');
      var questions = new Set();
      task.quiz.forEach(function (question) {
        plain(question, '自测题');
        id(question.id, '题目编号');
        if (questions.has(question.id)) fail('任务中存在重复题目编号。');
        if (!Array.isArray(question.options) || !question.options.length || !Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) fail('题目答案配置无效。');
        questions.add(question.id);
      });
      if (!task.oral || !Array.isArray(task.oral.checklist) || !task.oral.checklist.length) fail('任务必须包含口述核对项。');
      map.set(task.id, task);
    });
    return map;
  }

  function answers(value, task) {
    if (value === undefined) return {};
    plain(value, '自测答案');
    var result = {};
    Object.keys(value).forEach(function (key) {
      id(key, '题目编号');
      if (!Number.isInteger(value[key]) || value[key] < 0) fail('答案选项必须是非负整数。');
      if (task) {
        var question = task.quiz.find(function (q) { return q.id === key; });
        if (!question) fail('备份包含未知题目：' + key);
        if (value[key] >= question.options.length) fail('备份包含超出范围的答案选项。');
      }
      result[key] = value[key];
    });
    return result;
  }

  function checks(value, task) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100 || Array.from(value).some(function (v) { return typeof v !== 'boolean'; })) fail('口述核对必须由勾选状态组成。');
    if (task && value.length > task.oral.checklist.length) fail('口述核对项数量超出任务定义。');
    return value.slice();
  }

  function sameAnswers(left, right) {
    var a = Object.keys(left), b = Object.keys(right);
    return a.length === b.length && a.every(function (key) { return has(right, key) && left[key] === right[key]; });
  }

  function evaluate(task, selectedAnswers) {
    var feedback = task.quiz.map(function (question) {
      var selected = has(selectedAnswers, question.id) ? selectedAnswers[question.id] : null;
      return { id: question.id, correct: selected !== null && selected === question.answer, selected: selected, answer: question.answer, explanation: typeof question.explanation === 'string' ? question.explanation : '' };
    });
    var correct = feedback.filter(function (answer) { return answer.correct; }).length;
    return { correct: correct, total: task.quiz.length, passed: task.quiz.length > 0 && correct === task.quiz.length, feedback: feedback };
  }

  function allChecks(record, task) {
    return record.oralChecks.length === task.oral.checklist.length && Array.from(record.oralChecks).every(function (value) { return value === true; });
  }

  function freshState() {
    return { schemaVersion: 1, courseVersion: COURSE_VERSION, activeTaskId: null, tasks: {}, mistakes: {}, activity: [], updatedAt: null };
  }

  function normalizeState(raw, taskList) {
    var map = taskMap(taskList);
    if (raw === null || raw === undefined) return freshState();
    safeTree(raw, [], 0);
    plain(raw, '学习备份');
    keysOnly(raw, ['schemaVersion', 'courseVersion', 'activeTaskId', 'tasks', 'mistakes', 'activity', 'updatedAt'], '学习备份');
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) fail('不支持该备份版本，请使用当前网站导出的备份。');
    if (raw.courseVersion !== undefined && raw.courseVersion !== COURSE_VERSION) fail('备份课程版本与当前课程不一致。');
    var state = freshState();
    state.updatedAt = date(raw.updatedAt, '备份更新时间', true);
    state.activeTaskId = raw.activeTaskId === undefined || raw.activeTaskId === null ? null : id(raw.activeTaskId, '活动任务编号');
    if (state.activeTaskId !== null && !map.has(state.activeTaskId)) fail('备份包含未知的活动任务。');
    var records = raw.tasks === undefined ? {} : raw.tasks;
    plain(records, '任务进度');
    Object.keys(records).forEach(function (taskId) {
      if (!map.has(taskId)) fail('备份包含未知任务：' + taskId);
      var task = map.get(taskId), source = records[taskId];
      plain(source, '任务记录');
      keysOnly(source, ['status', 'answers', 'oralChecks', 'notes', 'grade', 'claimedAt', 'completedAt', 'updatedAt'], '任务记录');
      var status = source.status === undefined ? 'in_progress' : source.status;
      if (status !== 'in_progress' && status !== 'completed') fail('任务状态无效。');
      var record = { status: status, answers: answers(source.answers, task), oralChecks: checks(source.oralChecks, task), notes: note(source.notes === undefined ? '' : source.notes), grade: null, claimedAt: date(source.claimedAt, '领取时间', true), completedAt: date(source.completedAt, '完成时间', true), updatedAt: date(source.updatedAt, '任务更新时间', true) };
      if (source.grade !== undefined && source.grade !== null) {
        plain(source.grade, '自测成绩');
        keysOnly(source.grade, ['correct', 'total', 'passed', 'answers', 'gradedAt'], '自测成绩');
        var snapshot = answers(source.grade.answers, task), expected = evaluate(task, snapshot);
        if (source.grade.correct !== expected.correct || source.grade.total !== expected.total || source.grade.passed !== expected.passed || !sameAnswers(snapshot, record.answers)) fail('备份成绩与任务答案不一致，请重新自测。');
        record.grade = { correct: expected.correct, total: expected.total, passed: expected.passed, answers: snapshot, gradedAt: date(source.grade.gradedAt, '交卷时间', false) };
      }
      if (record.status === 'completed' && (!record.grade || !record.grade.passed || !allChecks(record, task))) fail('已完成任务缺少通过的自测或完整口述核对。');
      if (record.status !== 'completed' && record.completedAt !== null) fail('进行中的任务不能包含完成时间。');
      state.tasks[taskId] = record;
    });
    var firstIncomplete = null;
    taskList.forEach(function (task) {
      var record = state.tasks[task.id];
      if (!record || record.status !== 'completed') {
        if (firstIncomplete === null) firstIncomplete = task.id;
      } else if (firstIncomplete !== null) fail('备份中的完成顺序不合法，不能跳过前置任务。');
      if (record && record.status === 'in_progress' && state.activeTaskId !== task.id) fail('进行中的任务必须与当前领取任务一致。');
    });
    if (state.activeTaskId !== null) {
      var active = state.tasks[state.activeTaskId];
      if (!active || active.status === 'completed' || state.activeTaskId !== firstIncomplete) fail('当前领取任务必须是首个未完成任务。');
    }
    var mistakes = raw.mistakes === undefined ? {} : raw.mistakes;
    plain(mistakes, '错题记录');
    Object.keys(mistakes).forEach(function (key) {
      var source = mistakes[key];
      plain(source, '错题');
      keysOnly(source, ['taskId', 'questionId', 'wrongCount', 'lastWrongAt', 'resolved'], '错题');
      var task = map.get(source.taskId);
      if (!task || !state.tasks[source.taskId] || !task.quiz.some(function (q) { return q.id === source.questionId; }) || key !== source.taskId + ':' + source.questionId) fail('备份包含未知或不匹配的错题。');
      if (!Number.isInteger(source.wrongCount) || source.wrongCount < 1 || source.wrongCount > 10000000 || typeof source.resolved !== 'boolean') fail('错题记录格式无效。');
      if (state.tasks[source.taskId].status === 'completed' && !source.resolved) fail('已完成任务不能保留未订正的错题。');
      state.mistakes[key] = { taskId: source.taskId, questionId: source.questionId, wrongCount: source.wrongCount, lastWrongAt: date(source.lastWrongAt, '错题时间', false), resolved: source.resolved };
    });
    Object.keys(state.tasks).forEach(function (taskId) {
      var record = state.tasks[taskId];
      if (!record.grade) return;
      evaluate(map.get(taskId), record.answers).feedback.forEach(function (feedback) {
        var mistake = state.mistakes[taskId + ':' + feedback.id];
        if (!feedback.correct && (!mistake || mistake.resolved)) fail('未通过的自测缺少相应错题记录。');
        if (feedback.correct && mistake && !mistake.resolved) fail('已订正答案与错题状态不一致。');
      });
    });
    if (raw.activity !== undefined) {
      if (!Array.isArray(raw.activity) || raw.activity.length > MAX_ACTIVITY) fail('学习活动记录格式无效。');
      state.activity = raw.activity.map(function (entry) {
        plain(entry, '活动记录');
        keysOnly(entry, ['type', 'taskId', 'at', 'correct', 'total'], '活动记录');
        if (['claim', 'grade', 'complete'].indexOf(entry.type) === -1 || !map.has(entry.taskId) || !state.tasks[entry.taskId]) fail('活动记录包含未知操作或任务。');
        var result = { type: entry.type, taskId: entry.taskId, at: date(entry.at, '活动时间', false) };
        if (entry.type === 'grade') {
          if (!Number.isInteger(entry.correct) || !Number.isInteger(entry.total) || entry.total !== map.get(entry.taskId).quiz.length || entry.correct < 0 || entry.correct > entry.total) fail('交卷活动成绩无效。');
          result.correct = entry.correct;
          result.total = entry.total;
        } else if (entry.correct !== undefined || entry.total !== undefined) fail('该活动不应包含成绩。');
        return result;
      });
    }
    return state;
  }

  function nextTask(state, taskList) {
    if (state.activeTaskId) {
      var active = taskList.find(function (task) { return task.id === state.activeTaskId; });
      if (active && state.tasks[active.id] && state.tasks[active.id].status !== 'completed') return active;
    }
    return taskList.find(function (task) { return !state.tasks[task.id] || state.tasks[task.id].status !== 'completed'; }) || null;
  }

  function activity(state, entry) {
    state.activity.push(entry);
    if (state.activity.length > MAX_ACTIVITY) state.activity = state.activity.slice(-MAX_ACTIVITY);
  }

  function claimTask(state, taskList, nowISO) {
    taskMap(taskList);
    if (state.activeTaskId !== null) return state;
    var task = nextTask(state, taskList);
    if (!task) return state;
    var stamp = now(nowISO), result = copy(state);
    result.activeTaskId = task.id;
    result.tasks[task.id] = { status: 'in_progress', answers: {}, oralChecks: [], notes: '', grade: null, claimedAt: stamp, completedAt: null, updatedAt: stamp };
    result.updatedAt = stamp;
    activity(result, { type: 'claim', taskId: task.id, at: stamp });
    return result;
  }

  function editable(state, taskId) {
    id(taskId, '任务编号');
    var record = has(state.tasks, taskId) ? state.tasks[taskId] : null;
    if (!record) fail('请先领取该任务。');
    if (record.status === 'completed') return false;
    if (state.activeTaskId !== taskId) fail('只能编辑当前领取的任务。');
    return true;
  }

  function draftTask(state, taskId, patch, nowISO) {
    if (!editable(state, taskId)) return state;
    safeTree(patch, [], 0);
    plain(patch, '任务草稿');
    keysOnly(patch, ['answers', 'oralChecks', 'notes'], '任务草稿');
    var result = copy(state), record = result.tasks[taskId], stamp = now(nowISO);
    if (has(patch, 'answers')) {
      var incoming = answers(patch.answers);
      Object.keys(incoming).forEach(function (key) { record.answers[key] = incoming[key]; });
      if (!sameAnswers(record.answers, state.tasks[taskId].answers)) record.grade = null;
    }
    if (has(patch, 'oralChecks')) record.oralChecks = checks(patch.oralChecks);
    if (has(patch, 'notes')) record.notes = note(patch.notes);
    record.updatedAt = stamp;
    result.updatedAt = stamp;
    return result;
  }

  function gradeTask(state, task, nowISO) {
    taskMap([task]);
    var record = state.tasks[task.id];
    if (!record) fail('请先领取该任务，再提交自测。');
    var selected = answers(record.answers, task), result = evaluate(task, selected);
    if (!editable(state, task.id)) return { state: state, result: result };
    var stamp = now(nowISO), updated = copy(state);
    updated.tasks[task.id].grade = { correct: result.correct, total: result.total, passed: result.passed, answers: copy(selected), gradedAt: stamp };
    updated.tasks[task.id].updatedAt = stamp;
    updated.updatedAt = stamp;
    result.feedback.forEach(function (feedback) {
      var key = task.id + ':' + feedback.id, existing = updated.mistakes[key];
      if (!feedback.correct) updated.mistakes[key] = { taskId: task.id, questionId: feedback.id, wrongCount: existing ? existing.wrongCount + 1 : 1, lastWrongAt: stamp, resolved: false };
      else if (existing) existing.resolved = true;
    });
    activity(updated, { type: 'grade', taskId: task.id, at: stamp, correct: result.correct, total: result.total });
    return { state: updated, result: result };
  }

  function completeTask(state, task, nowISO) {
    taskMap([task]);
    if (!editable(state, task.id)) return state;
    var record = state.tasks[task.id], selected = answers(record.answers, task), calculated = evaluate(task, selected);
    if (!calculated.passed) fail('请先答对全部自测题，再完成任务。');
    if (!record.grade || !record.grade.passed || !sameAnswers(record.grade.answers, selected)) fail('请提交当前答案并通过自测，再完成任务。');
    if (!allChecks(record, task)) fail('请完成全部口述练习，并逐项勾选核对。');
    var stamp = now(nowISO), result = copy(state);
    result.tasks[task.id].status = 'completed';
    result.tasks[task.id].completedAt = stamp;
    result.tasks[task.id].updatedAt = stamp;
    result.activeTaskId = null;
    result.updatedAt = stamp;
    activity(result, { type: 'complete', taskId: task.id, at: stamp });
    return result;
  }

  function summary(state, taskList) {
    var completed = taskList.filter(function (task) { return state.tasks[task.id] && state.tasks[task.id].status === 'completed'; }).length;
    return { total: taskList.length, completed: completed, percent: taskList.length ? Math.round(completed / taskList.length * 100) : 0, activeTaskId: state.activeTaskId, mistakes: Object.keys(state.mistakes).filter(function (key) { return !state.mistakes[key].resolved; }).length };
  }

  return { freshState: freshState, normalizeState: normalizeState, nextTask: nextTask, claimTask: claimTask, draftTask: draftTask, gradeTask: gradeTask, completeTask: completeTask, summary: summary };
});
