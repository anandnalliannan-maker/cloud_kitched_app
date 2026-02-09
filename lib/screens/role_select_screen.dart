import 'package:flutter/material.dart';

enum UserRole { owner, delivery, customer }

class RoleSelectScreen extends StatefulWidget {
  const RoleSelectScreen({super.key});

  @override
  State<RoleSelectScreen> createState() => _RoleSelectScreenState();
}

class _RoleSelectScreenState extends State<RoleSelectScreen> {
  UserRole? selectedRole;

  void _continue() {
    if (selectedRole == null) return;
    final roleName = selectedRole!.name;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Selected role: $roleName')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Select Role')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            _RoleTile(
              title: 'Customer',
              subtitle: 'Anyone can register',
              selected: selectedRole == UserRole.customer,
              onTap: () => setState(() => selectedRole = UserRole.customer),
            ),
            _RoleTile(
              title: 'Owner',
              subtitle: 'Access given by admin only',
              selected: selectedRole == UserRole.owner,
              onTap: () => setState(() => selectedRole = UserRole.owner),
            ),
            _RoleTile(
              title: 'Delivery Boy',
              subtitle: 'Added by owner only',
              selected: selectedRole == UserRole.delivery,
              onTap: () => setState(() => selectedRole = UserRole.delivery),
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: selectedRole == null ? null : _continue,
                child: const Text('Continue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  const _RoleTile({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? Theme.of(context).colorScheme.primary
                  : Colors.grey.shade300,
              width: selected ? 2 : 1,
            ),
            color: selected
                ? Theme.of(context).colorScheme.primary.withValues(alpha: 0.08)
                : Colors.white,
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                color: selected
                    ? Theme.of(context).colorScheme.primary
                    : Colors.grey,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
