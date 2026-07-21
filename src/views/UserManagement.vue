<template>
  <div class="user-management-page">
    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>用户管理</span>
          <el-button type="primary" @click="openCreateDialog">新建用户</el-button>
        </div>
      </template>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="error-alert" />
      <el-table v-loading="loading" :data="users" stripe>
        <el-table-column prop="username" label="用户名" width="160" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            {{ roleLabel(row.role) }}
          </template>
        </el-table-column>
        <el-table-column prop="displayName" label="显示名" width="160" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column prop="disabled" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.disabled ? 'danger' : 'success'">
              {{ row.disabled ? '已禁用' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" @click="openResetDialog(row)">重置密码</el-button>
            <el-button
              size="small"
              :type="row.disabled ? 'success' : 'warning'"
              :disabled="isSelf(row)"
              @click="toggleDisabled(row)"
            >
              {{ row.disabled ? '启用' : '禁用' }}
            </el-button>
            <el-button size="small" type="danger" :disabled="isSelf(row)" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="createVisible" title="新建用户" width="500px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="用户名">
          <el-input v-model="createForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="createForm.password" type="password" placeholder="请输入密码" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createForm.role" placeholder="请选择角色" style="width: 100%">
            <el-option label="售后测试" value="after_sales" />
            <el-option label="研发" value="rd" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="createForm.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="createForm.email" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onCreate">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑用户" width="500px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="用户名">
          <el-input v-model="editForm.username" disabled />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role" placeholder="请选择角色" style="width: 100%">
            <el-option label="售后测试" value="after_sales" />
            <el-option label="研发" value="rd" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="editForm.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetVisible" title="重置密码" width="500px">
      <p>正在为 <strong>{{ resetTarget?.username }}</strong> 设置新密码</p>
      <el-form :model="resetForm" label-width="100px">
        <el-form-item label="新密码">
          <el-input v-model="resetForm.password" type="password" placeholder="请输入新密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import {
  createUser,
  deleteUser,
  listUsers,
  resetPassword,
  toggleUserDisabled,
  updateUser,
  type User
} from '@/api/users'

const auth = useAuthStore()
const users = ref<User[]>([])
const loading = ref(false)
const submitting = ref(false)
const error = ref('')

const createVisible = ref(false)
const createForm = reactive({
  username: '',
  password: '',
  role: 'after_sales' as User['role'],
  displayName: '',
  email: ''
})

const editVisible = ref(false)
const editForm = reactive({
  id: 0,
  username: '',
  role: 'after_sales' as User['role'],
  displayName: '',
  email: ''
})

const resetVisible = ref(false)
const resetTarget = ref<User | null>(null)
const resetForm = reactive({
  password: ''
})

onMounted(() => {
  loadUsers()
})

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    users.value = await listUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function isSelf(row: User) {
  return row.id === auth.user?.id
}

function openCreateDialog() {
  createForm.username = ''
  createForm.password = ''
  createForm.role = 'after_sales'
  createForm.displayName = ''
  createForm.email = ''
  error.value = ''
  createVisible.value = true
}

async function onCreate() {
  if (!createForm.username.trim() || !createForm.password.trim()) {
    ElMessage.error('用户名和密码不能为空')
    return
  }
  submitting.value = true
  try {
    await createUser({
      username: createForm.username.trim(),
      password: createForm.password,
      role: createForm.role,
      displayName: createForm.displayName.trim() || undefined,
      email: createForm.email.trim() || undefined
    })
    createVisible.value = false
    ElMessage.success('创建成功')
    await loadUsers()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  } finally {
    submitting.value = false
  }
}

function openEditDialog(row: User) {
  editForm.id = row.id
  editForm.username = row.username
  editForm.role = row.role
  editForm.displayName = row.displayName || ''
  editForm.email = row.email || ''
  editVisible.value = true
}

async function onEdit() {
  submitting.value = true
  try {
    await updateUser(editForm.id, {
      role: editForm.role,
      displayName: editForm.displayName.trim() || undefined,
      email: editForm.email.trim() || undefined
    })
    editVisible.value = false
    ElMessage.success('保存成功')
    await loadUsers()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

function openResetDialog(row: User) {
  resetTarget.value = row
  resetForm.password = ''
  resetVisible.value = true
}

async function onReset() {
  if (!resetTarget.value || !resetForm.password.trim()) {
    ElMessage.error('请输入新密码')
    return
  }
  submitting.value = true
  try {
    await resetPassword(resetTarget.value.id, resetForm.password)
    resetVisible.value = false
    ElMessage.success('密码已重置')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '重置失败')
  } finally {
    submitting.value = false
  }
}

async function toggleDisabled(row: User) {
  const action = row.disabled ? '启用' : '禁用'
  try {
    await ElMessageBox.confirm(`确定要${action}用户 ${row.username} 吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await toggleUserDisabled(row.id, !row.disabled)
    ElMessage.success(`${action}成功`)
    await loadUsers()
  } catch (e) {
    if (e === 'cancel' || (e instanceof Error && e.message === 'cancel')) return
    ElMessage.error(e instanceof Error ? e.message : `${action}失败`)
  }
}

async function onDelete(row: User) {
  try {
    await ElMessageBox.confirm(`确定要删除用户 ${row.username} 吗？删除后不可恢复。`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'error'
    })
    await deleteUser(row.id)
    ElMessage.success('删除成功')
    await loadUsers()
  } catch (e) {
    if (e === 'cancel' || (e instanceof Error && e.message === 'cancel')) return
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

function roleLabel(role: User['role']) {
  const map: Record<User['role'], string> = {
    after_sales: '售后测试',
    rd: '研发',
    admin: '管理员'
  }
  return map[role] || role
}
</script>

<style scoped>
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.error-alert {
  margin-bottom: 12px;
}
</style>
